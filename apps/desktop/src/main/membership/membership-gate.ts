// 负责以服务端实时授权为会员门禁，使用共享逻辑会话归属隔离迟到请求。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  MembershipInspectRequest,
  OAuthDesktopSession,
} from "@pigclaude/contracts/desktop-membership"
import type { SecretVault } from "../secret-vault"
import type { PigclaudeApi } from "../api/pigclaude-api-client"
import { PigclaudeApiError } from "../api/oauth-client"
import { OAuthTokenManager, codeOf, type OAuthSnapshot } from "../authorization/oauth-token-manager"

/** 会员端口始终接受原请求捕获的 Bearer；生产同时提供实时身份验证。 */
export type MembershipGateApi = {
  inspectMembership(input: MembershipInspectRequest, accessToken?: string): Promise<MembershipView>
  revokeDeviceBinding(accessToken?: string): Promise<void>
  readDesktopSession?: PigclaudeApi["readDesktopSession"]
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
  readonly #listeners = new Set<(view: MembershipView) => void>()
  #view: MembershipView = initialView()
  #revision = 0
  #reads = 0
  #disposed = false
  #visibleOwner: number | null = null

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
  }

  /** 恢复后与每次受限操作前重新核验原账号、版本、关系及会员。 */
  async inspect(): Promise<MembershipView> {
    const read = ++this.#reads
    const owner = this.#tokens.owner
    if (this.#disposed) return this.view()
    let identity: OAuthSnapshot | undefined
    try {
      const snapshot = await this.#tokens.snapshot()
      if (!snapshot) {
        if (this.current(read, owner)) return this.publish(signedOutView())
        return this.view()
      }
      const remote = await this.#tokens.run(async (current) => {
        identity = current
        await this.verifyIdentity(current)
        const scopes = current.record.scope.split(" ")
        if (!scopes.includes("membership:read") || !scopes.includes("device:inspect")) {
          throw new PigclaudeApiError("insufficient_scope", 403)
        }
        return this.#api.inspectMembership(
          {
            deviceId: current.record.deviceId,
            bindingEpoch: current.record.bindingEpoch,
          },
          current.record.accessToken,
        )
      })
      if (!this.current(read, owner)) return this.view()
      this.#visibleOwner = owner
      if (remote.bindingEpoch !== null && remote.bindingEpoch !== identity?.record.bindingEpoch) {
        return this.clearSession(owner, "DEVICE_REVOKED", "AUTHORIZATION_BINDING_STALE")
      }
      return this.publish(this.normalizeRemote(remote))
    } catch (error: unknown) {
      const code = codeOf(error)
      if (
        !this.#disposed &&
        this.#tokens.isCurrent(owner) &&
        (code === "ACCOUNT_BANNED" || code === "DEVICE_REVOKED")
      )
        return this.clearSession(owner, code)
      if (!this.current(read, owner)) return this.view()
      const view = identity ? this.identityView(identity) : initialView()
      const state =
        code === "SAFE_STORAGE_UNAVAILABLE"
          ? "configuration_error"
          : code === "AUTHORIZATION_REQUIRED" ||
              code === "invalid_grant" ||
              code === "invalid_token"
            ? "verification_required"
            : code === "AUTHORIZATION_EXPIRED" || code === "MEMBERSHIP_EXPIRED"
              ? "expired"
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
    return { ...this.#view, account: this.#view.account ? { ...this.#view.account } : null }
  }

  /** 撤销原逻辑会话的当前关系；同族刷新不取消结果，新 grant 则隔离。 */
  async revoke(): Promise<MembershipView> {
    const owner = this.#tokens.owner
    if (this.#visibleOwner !== null && this.#visibleOwner !== owner) return this.view()
    if (this.#disposed) return this.view()
    try {
      const snapshot = await this.#tokens.snapshot()
      if (!this.#tokens.isCurrent(owner)) return this.view()
      if (!snapshot) return this.clearSession(owner)
      await this.#tokens.run(async (current) => {
        await this.verifyIdentity(current)
        if (!current.record.scope.split(" ").includes("device:revoke"))
          throw new PigclaudeApiError("insufficient_scope", 403)
        if (!this.#tokens.isCurrent(owner))
          throw new PigclaudeApiError("AUTHORIZATION_CANCELLED", 0)
        await this.#api.revokeDeviceBinding(current.record.accessToken)
      })
      if (!this.#tokens.isCurrent(owner)) return this.view()
      return this.clearSession(owner)
    } catch (error: unknown) {
      if (!this.#tokens.isCurrent(owner)) return this.view()
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
    this.#reads++
    void this.#tokens.suspend()
    this.#listeners.clear()
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
    terminal?: "ACCOUNT_BANNED" | "DEVICE_REVOKED",
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
