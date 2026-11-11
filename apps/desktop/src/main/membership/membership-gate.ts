// 负责以服务端实时授权为会员门禁，使用共享逻辑会话归属隔离迟到请求。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  MembershipInspectRequest,
  OAuthDesktopSession,
  DesktopRecoverySnapshot,
} from "@pigclaude/contracts/desktop-membership"
import type { SecretVault } from "../secret-vault"
import type { PigclaudeApi } from "../api/pigclaude-api-client"
import { PigclaudeApiError } from "../api/oauth-client"
import { OAuthTokenManager, codeOf, type OAuthSnapshot } from "../authorization/oauth-token-manager"
import { recoveryView, type RecoveryMembershipView } from "./recovery-view"
import { DESKTOP_BUSINESS_SCOPES } from "@pigclaude/contracts/desktop-membership"
import { randomUUID } from "node:crypto"

/** 会员端口始终接受原请求捕获的 Bearer；生产同时提供实时身份验证。 */
export type MembershipGateApi = {
  inspectMembership(input: MembershipInspectRequest, accessToken?: string): Promise<MembershipView>
  revokeDeviceBinding(accessToken?: string): Promise<void>
  readDesktopSession?: PigclaudeApi["readDesktopSession"]
  /** 正式网络客户端固定提供；独立旧端口合同测试可以省略。 */
  readRecovery?: (accessToken: string) => Promise<DesktopRecoverySnapshot>
}
/** 门禁与第一方代码提交、刷新、退出共用一个 tokenManager。 */
export type MembershipGateOptions = {
  api: MembershipGateApi
  vault: SecretVault
  tokenManager?: OAuthTokenManager
  now?: () => number
}
/** 每次检查都访问服务端，不从磁盘或旧 active 视图授予离线能力。 */
export class MembershipGate {
  readonly #api: MembershipGateApi
  readonly #tokens: OAuthTokenManager
  readonly #now: () => number
  readonly #unsubscribeInvalidatedGrant: () => void
  readonly #listeners = new Set<(view: MembershipView) => void>()
  #view: MembershipView = initialView()
  #revision = 0
  #reads = 0
  #disposed = false
  #visibleOwner: number | null = null
  #actionContext: { owner: number; id: string } | null = null

  /** 构建实时会员门禁；独立端口测试不隐式模拟刷新服务。 */
  constructor(options: MembershipGateOptions) {
    this.#api = options.api
    this.#now = options.now ?? Date.now
    this.#tokens =
      options.tokenManager ??
      new OAuthTokenManager({
        vault: options.vault,
        now: this.#now,
        api: {
          refreshToken: async () => {
            throw new PigclaudeApiError("AUTHORIZATION_REQUIRED", 0)
          },
        },
      })
    this.#unsubscribeInvalidatedGrant = this.#tokens.subscribeInvalidatedGrant((owner) => {
      if (this.#disposed || !this.#tokens.isCurrent(owner)) return
      this.#reads++
      this.#visibleOwner = null
      this.publish({
        ...initialView(),
        state: "verification_required",
        errorCode: "invalid_grant",
        serverReason: "invalid_grant",
      })
    })
  }

  /** 恢复后与每次受限操作前重新核验原账号、版本、关系及会员。 */
  async inspect(): Promise<MembershipView> {
    const read = ++this.#reads
    const owner = this.#tokens.owner
    if (this.#disposed) return this.view()
    let identity: OAuthSnapshot | undefined
    let recovered: RecoveryMembershipView | undefined
    try {
      const snapshot = await this.#tokens.snapshot()
      if (!snapshot) {
        if (this.current(read, owner)) return this.publish(signedOutView())
        return this.view()
      }
      const remote = await this.#tokens.run(async (current) => {
        identity = current
        const facts = await this.readRecovery(current)
        if (facts) {
          recovered = recoveryView(facts)
          if (facts.membership.status !== "active") return recovered
          if (
            DESKTOP_BUSINESS_SCOPES.some(
              (scope) => !current.record.scope.split(" ").includes(scope),
            )
          ) {
            if (Date.parse(facts.grantExpiresAt) <= this.#now())
              throw new PigclaudeApiError("AUTHORIZATION_REQUIRED", 401)
            const recoveryKey =
              facts.membership.entitlementVersion ??
              facts.membership.validUntil ??
              facts.grantExpiresAt
            current = await this.#tokens.restoreMembershipCapabilities(current.owner, recoveryKey)
            identity = current
            await this.verifyIdentity(current)
          }
        }
        const scopes = current.record.scope.split(" ")
        if (DESKTOP_BUSINESS_SCOPES.some((scope) => !scopes.includes(scope))) {
          throw new PigclaudeApiError("insufficient_scope", 403)
        }
        const checked = await this.#api.inspectMembership(
          {
            deviceId: current.record.deviceId,
            bindingEpoch: current.record.bindingEpoch,
          },
          current.record.accessToken,
        )
        return recovered
          ? { ...checked, account: recovered.account, recovery: recovered.recovery }
          : checked
      })
      if (!this.current(read, owner)) return this.view()
      this.#visibleOwner = owner
      if (remote.bindingEpoch !== null && remote.bindingEpoch !== identity?.record.bindingEpoch) {
        return this.clearSession(owner, "DEVICE_REVOKED", "AUTHORIZATION_BINDING_STALE")
      }
      return this.publish(this.normalizeRemote(remote))
    } catch (error: unknown) {
      const code = codeOf(error)
      // grant明确失效时一并终结逻辑归属，不能让先前已开始的授权响应重新提交登录。
      if (
        !this.#disposed &&
        this.#tokens.isCurrent(owner) &&
        (code === "ACCOUNT_BANNED" || code === "DEVICE_REVOKED" || code === "invalid_grant")
      )
        return this.clearSession(owner, code)
      if (!this.current(read, owner)) return this.view()
      const view = recovered ?? (identity ? this.identityView(identity) : initialView())
      const state =
        code === "SAFE_STORAGE_UNAVAILABLE"
          ? "configuration_error"
          : code === "AUTHORIZATION_REQUIRED" ||
              code === "invalid_token" ||
              code === "invalid_scope" ||
              code === "AUTHORIZATION_EXPIRED" ||
              code === "MEMBERSHIP_EXPIRED"
            ? "verification_required"
            : code === "insufficient_scope" ||
                code === "AUTHORIZATION_UNAUTHORIZED" ||
                code === "access_denied"
              ? "verification_required"
              : "error"
      this.#visibleOwner = owner
      return this.publish({ ...view, state, errorCode: code, serverReason: code })
    }
  }

  /** 订阅脱敏快照，返回移除当前 listener 的清理函数。 */
  subscribe(listener: (view: MembershipView) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 只返回脱敏业务视图，不返回任何凭据。 */
  view(): MembershipView {
    return {
      ...this.#view,
      account: this.#view.account ? { ...this.#view.account } : null,
      ...(this.#view.recovery ? { recovery: { ...this.#view.recovery } } : {}),
    }
  }

  /** 只捕获当前已展示账号的动作上下文，拒绝迟到界面替新会话办理会员。 */
  async captureAccountAction(contextId: string): Promise<OAuthSnapshot> {
    const owner = this.#tokens.owner
    if (!this.matchesAccountContext(contextId, owner))
      throw new PigclaudeApiError("RECOVERY_CONTEXT_CHANGED", 0)
    const snapshot = await this.#tokens.snapshot()
    if (
      !snapshot ||
      !this.matchesAccountContext(contextId, owner) ||
      snapshot.record.userId !== this.#view.account?.userId
    )
      throw new PigclaudeApiError("RECOVERY_CONTEXT_CHANGED", 0)
    return snapshot
  }

  /** 为确认绑定当前账号与设备关系，合法同族刷新后仍核对完整身份和撤销范围。 */
  async prepareRevocation(contextId: string): Promise<OAuthSnapshot> {
    const captured = await this.captureAccountAction(contextId)
    const verified = await this.#tokens.run(async (current) => {
      if (!sameAuthorizationTarget(current, captured))
        throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
      await this.verifyIdentity(current)
      if (!current.record.scope.split(" ").includes("device:revoke"))
        throw new PigclaudeApiError("insufficient_scope", 403)
      return current
    })
    if (!this.matchesAccountContext(contextId, captured.owner))
      throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
    return verified
  }

  /** 同族合法刷新保留上下文，新 grant、退出和关系失效立即使旧上下文失效。 */
  matchesAccountContext(contextId: string, owner: number): boolean {
    return (
      !this.#disposed &&
      this.#tokens.isCurrent(owner) &&
      this.#visibleOwner === owner &&
      this.#actionContext?.owner === owner &&
      this.#actionContext.id === contextId &&
      this.#view.actionContextId === contextId
    )
  }

  /** 撤销原逻辑会话的当前关系；同族刷新不取消结果，新 grant 则隔离。 */
  async revoke(expected?: OAuthSnapshot): Promise<MembershipView> {
    const stale = (): MembershipView => {
      if (expected) throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
      return this.view()
    }
    if (expected && !this.#tokens.isCurrent(expected.owner))
      throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
    const owner = this.#tokens.owner
    if (this.#visibleOwner !== null && this.#visibleOwner !== owner) return stale()
    if (this.#disposed) return stale()
    try {
      const snapshot = await this.#tokens.snapshot()
      if (!this.#tokens.isCurrent(owner)) return stale()
      if (!snapshot) {
        if (expected) throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
        return this.clearSession(owner)
      }
      if (expected && !sameAuthorizationTarget(snapshot, expected))
        throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
      await this.#tokens.run(async (current) => {
        if (expected && !sameAuthorizationTarget(current, expected))
          throw new PigclaudeApiError("WITHDRAWAL_TARGET_CHANGED", 0)
        await this.verifyIdentity(current)
        if (!current.record.scope.split(" ").includes("device:revoke"))
          throw new PigclaudeApiError("insufficient_scope", 403)
        if (!this.#tokens.isCurrent(owner))
          throw new PigclaudeApiError("AUTHORIZATION_CANCELLED", 0)
        await this.#api.revokeDeviceBinding(current.record.accessToken)
      })
      if (!this.#tokens.isCurrent(owner)) return stale()
      return this.clearSession(owner)
    } catch (error: unknown) {
      if (!this.#tokens.isCurrent(owner)) return stale()
      const code = codeOf(error)
      if (code === "ACCOUNT_BANNED" || code === "DEVICE_REVOKED")
        return this.clearSession(owner, code)
      throw error
    }
  }

  /** 同步暂停所有 owner，退出只等待已进入本机秘密写入，不等待网络。 */
  async signOut(secretWrites: Promise<void> = Promise.resolve()): Promise<MembershipView> {
    const writes = this.#tokens.suspend()
    this.#reads++
    try {
      await Promise.all([writes, secretWrites])
      await this.#tokens.clear()
      this.#visibleOwner = null
      this.#tokens.resume()
      return this.publish(signedOutView())
    } catch (error: unknown) {
      this.publish({
        ...initialView(),
        state: "configuration_error",
        errorCode: "LOCAL_SIGN_OUT_FAILED",
      })
      throw error
    }
  }

  /** 新授权提交后清除原账号的可用视图，后续检查只代表新身份。 */
  async acceptAuthorization(
    record: OAuthDesktopSession,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    this.#reads++
    const adopting = this.#tokens.adopt(record, isCurrent)
    const owner = this.#tokens.owner
    await adopting
    if (!this.#tokens.isCurrent(owner)) return
    this.#visibleOwner = owner
    this.publish(this.identityView({ owner, record }))
  }

  /** 释放监听并同步拒绝迟到网络发布。 */
  dispose(): void {
    this.#disposed = true
    this.#unsubscribeInvalidatedGrant()
    this.#reads++
    void this.#tokens.suspend()
    this.#listeners.clear()
  }

  private async readRecovery(
    snapshot: OAuthSnapshot,
  ): Promise<DesktopRecoverySnapshot | undefined> {
    if (!this.#api.readRecovery) {
      await this.verifyIdentity(snapshot)
      return undefined
    }
    const facts = await this.#api.readRecovery(snapshot.record.accessToken)
    if (!this.#tokens.isCurrent(snapshot.owner))
      throw new PigclaudeApiError("AUTHORIZATION_CANCELLED", 0)
    const record = snapshot.record
    if (
      facts.userId !== record.userId ||
      facts.deviceId !== record.deviceId ||
      facts.bindingEpoch !== record.bindingEpoch ||
      facts.authVersion !== record.authVersion
    )
      throw new PigclaudeApiError("DEVICE_REVOKED", 401)
    return facts
  }

  private async verifyIdentity({ owner, record }: OAuthSnapshot): Promise<void> {
    if (!this.#api.readDesktopSession) return
    const actual = await this.#api.readDesktopSession(record.accessToken)
    if (!this.#tokens.isCurrent(owner)) throw new PigclaudeApiError("AUTHORIZATION_CANCELLED", 0)
    if (
      actual.userId !== record.userId ||
      actual.deviceId !== record.deviceId ||
      actual.bindingEpoch !== record.bindingEpoch ||
      actual.authVersion !== record.authVersion
    ) {
      throw new PigclaudeApiError("DEVICE_REVOKED", 401)
    }
  }

  private current(read: number, owner: number): boolean {
    return !this.#disposed && read === this.#reads && this.#tokens.isCurrent(owner)
  }

  private async clearSession(
    owner: number,
    terminal?: "ACCOUNT_BANNED" | "DEVICE_REVOKED" | "invalid_grant",
    errorCode: string | undefined = terminal,
  ): Promise<MembershipView> {
    if (!this.#tokens.isCurrent(owner)) return this.view()
    const clearing = this.#tokens.clear(owner)
    const clearedOwner = this.#tokens.owner
    this.#reads++
    this.#visibleOwner = null
    const view = terminal
      ? {
          ...initialView(),
          state:
            terminal === "DEVICE_REVOKED"
              ? ("device_revoked" as const)
              : ("verification_required" as const),
          errorCode: errorCode ?? null,
          serverReason: terminal,
        }
      : signedOutView()
    this.publish(view)
    try {
      await clearing
    } catch {
      if (this.#tokens.isCurrent(clearedOwner))
        return this.publish({
          ...view,
          state: "configuration_error",
          errorCode: "SAFE_STORAGE_UNAVAILABLE",
        })
    }
    return this.view()
  }

  private identityView({ record }: OAuthSnapshot): MembershipView {
    return {
      ...initialView(),
      account: { userId: record.userId, nickname: "", email: "", avatar: "" },
      bindingEpoch: record.bindingEpoch,
    }
  }

  private normalizeRemote(view: MembershipView): MembershipView {
    const state = view.state as string
    if (state === "inactive" || state === "revoked")
      return { ...view, state: "verification_required", errorCode: "AUTHORIZATION_UNAUTHORIZED" }
    return {
      ...view,
      offlineValidUntil: null,
      lastVerifiedAt: view.lastVerifiedAt ?? new Date(this.#now()).toISOString(),
      nextVerificationAt: new Date(this.#now() + 30_000).toISOString(),
    }
  }

  private publish(view: MembershipView): MembershipView {
    if (this.#disposed) return this.view()
    this.#revision = Math.max(this.#revision + 1, view.revision)
    this.#view = { ...view, revision: this.#revision, startupPhase: "settled" }
    if (this.#view.account && this.#visibleOwner === this.#tokens.owner) {
      const owner = this.#tokens.owner
      if (this.#actionContext?.owner !== owner) this.#actionContext = { owner, id: randomUUID() }
      this.#view.actionContextId = this.#actionContext.id
    } else {
      delete this.#view.actionContextId
    }
    const safe = this.view()
    for (const listener of this.#listeners) listener(safe)
    return safe
  }
}
function initialView(): MembershipView {
  return {
    startupPhase: "checking",
    revision: 0,
    state: "connecting",
    account: null,
    tier: null,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: null,
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
  }
}
function signedOutView(): MembershipView {
  return { ...initialView(), startupPhase: "settled", state: "signed_out" }
}

// 逻辑会话必须相同；访问凭据轮换不改变确认对象，账号、设备或代次变化则失效。
function sameAuthorizationTarget(a: OAuthSnapshot, b: OAuthSnapshot): boolean {
  return (
    a.owner === b.owner &&
    a.record.userId === b.record.userId &&
    a.record.deviceId === b.record.deviceId &&
    a.record.bindingEpoch === b.record.bindingEpoch &&
    a.record.authVersion === b.record.authVersion
  )
}
