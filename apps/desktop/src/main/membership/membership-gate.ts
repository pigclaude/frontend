// 负责以 Rust 服务端为权威检查本机会员与设备绑定，并隔离 safeStorage 秘密。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  DesktopMembershipErrorCode,
  MembershipInspectRequest,
  OAuthDesktopSession,
} from "@pigclaude/contracts/desktop-membership"
import type { SecretVault } from "../secret-vault"
import { parseOAuthDesktopSession } from "../authorization/oauth-session"

/** MembershipGate 调用的最小 API 端口，不允许 gate 依赖 Electron 或 HTTP 实现。 */
export type MembershipGateApi = {
  inspectMembership(input: MembershipInspectRequest, accessToken?: string): Promise<MembershipView>
  revokeDeviceBinding(accessToken?: string): Promise<void>
}

/** MembershipGate 的依赖，保证时钟和安全仓库可在测试中替换。 */
export type MembershipGateOptions = {
  api: MembershipGateApi
  vault: SecretVault
  now?: () => number
}

/** 主进程会员门禁，保证重启检查服务端而不是 localStorage。 */
export class MembershipGate {
  readonly #api: MembershipGateApi
  readonly #vault: SecretVault
  readonly #now: () => number
  readonly #listeners = new Set<(view: MembershipView) => void>()
  #record: OAuthDesktopSession | null = null
  #view: MembershipView = initialView()
  #revision = 0
  #readGeneration = 0
  #sessionGeneration = 0
  #disposed = false
  #locallySignedOut = false
  #mutation: Promise<void> = Promise.resolve()

  /** 创建只依赖 API、时钟和安全仓库的会员门禁。 */
  constructor(options: MembershipGateOptions) {
    this.#api = options.api
    this.#vault = options.vault
    this.#now = options.now ?? Date.now
  }

  /** 从 safeStorage 恢复设备材料并重新向 Rust 检查会员状态。 */
  async inspect(): Promise<MembershipView> {
    // 本地材料写入/撤销按序完成后才读取；每次请求只能发布自己的当前代次。
    for (;;) {
      const mutation = this.#mutation
      await mutation
      if (mutation === this.#mutation) break
    }
    if (this.#disposed) return this.view()
    if (this.#locallySignedOut) return this.view()
    const generation = ++this.#readGeneration
    let raw: string | null
    try {
      raw = await this.#vault.get("membership:session")
    } catch {
      if (!this.isCurrentRead(generation)) return this.view()
      return this.publish(
        this.withState(initialView(), "configuration_error", "SAFE_STORAGE_UNAVAILABLE"),
      )
    }
    if (!this.isCurrentRead(generation)) return this.view()
    const record = parseOAuthDesktopSession(raw)
    this.adoptRecord(record)
    if (!record) return this.publish(signedOutView())
    const owner = this.#sessionGeneration
    try {
      const remote = await this.#api.inspectMembership(
        {
          deviceId: record.deviceId,
          bindingEpoch: record.bindingEpoch,
        },
        record.accessToken,
      )
      if (!this.isCurrentRead(generation) || !this.isCurrentSession(owner)) return this.view()
      if (
        remote.bindingEpoch !== null &&
        record.bindingEpoch !== "" &&
        remote.bindingEpoch !== record.bindingEpoch
      ) {
        return this.publish(this.withState(remote, "device_revoked", "AUTHORIZATION_BINDING_STALE"))
      }
      return this.publish(this.normalizeRemote(remote))
    } catch (error: unknown) {
      if (!this.isCurrentRead(generation) || !this.isCurrentSession(owner)) return this.view()
      const errorCode = errorCodeOf(error, "SERVER_UNAVAILABLE")
      const state =
        errorCode === "DEVICE_REVOKED" ||
        errorCode === "AUTHORIZATION_DEVICE_REVOKED" ||
        errorCode === "AUTHORIZATION_BINDING_STALE"
          ? "device_revoked"
          : errorCode === "AUTHORIZATION_EXPIRED"
            ? "expired"
            : errorCode === "AUTHORIZATION_UNAUTHORIZED"
              ? "verification_required"
              : "error"
      if (errorCode === "ACCOUNT_BANNED" || errorCode === "DEVICE_REVOKED") {
        return this.clearSession(owner, record, errorCode)
      }
      return this.publish(this.withState(this.#view, state, errorCode))
    }
  }

  /** 订阅脱敏会员快照，返回只移除当前 listener 的清理函数。 */
  subscribe(listener: (view: MembershipView) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 返回当前脱敏快照；不会读取或返回 safeStorage 中的秘密。 */
  view(): MembershipView {
    return { ...this.#view, account: this.#view.account ? { ...this.#view.account } : null }
  }

  /** 捕获原 session/token 撤销关系，普通同会话检查不取消操作，远端等待不占本机队列。 */
  async revoke(): Promise<MembershipView> {
    const initialOwner = this.#sessionGeneration
    const initialRecord = this.#record
    // 只等待本机写队列；等待期间换凭据不能把原可见操作重绑给新 grant。
    for (;;) {
      const mutation = this.#mutation
      await mutation
      if (!this.isCurrentSession(initialOwner) || this.#locallySignedOut) return this.view()
      if (mutation === this.#mutation) break
    }
    if (initialRecord && !sameSession(initialRecord, this.#record)) return this.view()
    const record =
      this.#record ?? parseOAuthDesktopSession(await this.#vault.get("membership:session"))
    if (!this.isCurrentSession(initialOwner) || this.#locallySignedOut) return this.view()
    this.adoptRecord(record)
    const owner = this.#sessionGeneration
    if (record) {
      try {
        await this.#api.revokeDeviceBinding(record.accessToken)
      } catch (error: unknown) {
        if (!this.isCurrentSession(owner)) return this.view()
        const code = errorCodeOf(error, "SERVER_UNAVAILABLE")
        if (code === "ACCOUNT_BANNED" || code === "DEVICE_REVOKED") {
          return this.clearSession(owner, record, code)
        }
        throw error
      }
    }
    if (!this.isCurrentSession(owner)) return this.view()
    return this.clearSession(owner, record)
  }

  /** 只退出本机 profile；等待旧写入后清理全部授权，失败时阻止检查恢复旧会话。 */
  signOut(secretWrites: Promise<void> = Promise.resolve()): Promise<MembershipView> {
    this.#sessionGeneration++
    this.#locallySignedOut = true
    return this.mutate(async () => {
      if (this.#disposed) throw new Error("会员服务已关闭")
      try {
        await secretWrites
        if (!this.#vault.deletePrefix) throw new Error("安全仓库不支持完整清理授权")
        await this.#vault.deletePrefix("authorization:pigclaude-login:")
        await this.#vault.delete("membership:session")
        this.#record = null
        this.#locallySignedOut = true
        return this.publish(signedOutView())
      } catch (error: unknown) {
        this.#locallySignedOut = true
        this.publish(this.withState(initialView(), "configuration_error", "LOCAL_SIGN_OUT_FAILED"))
        throw error
      }
    })
  }

  /** 在本机写入屏障内接收当前 OAuth2 材料，失效代次不能发布或恢复记录。 */
  async acceptAuthorization(
    input: OAuthDesktopSession,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const record = parseOAuthDesktopSession(JSON.stringify(input))
    if (!record) throw new Error("INVALID_OAUTH_SESSION")
    const owner = ++this.#sessionGeneration
    await this.mutate(async () => {
      if (!this.isCurrentSession(owner) || !isCurrent()) return
      await this.#vault.set("membership:session", JSON.stringify(record))
      if (this.isCurrentSession(owner) && isCurrent()) {
        this.#record = record
        this.#locallySignedOut = false
      }
    })
  }

  /** 释放 gate 订阅，供 composition 的 ordered cleanup 使用。 */
  dispose(): void {
    this.#disposed = true
    this.#sessionGeneration++
    this.#readGeneration++
    this.#listeners.clear()
  }

  private isCurrentRead(generation: number): boolean {
    return !this.#disposed && this.#readGeneration === generation
  }

  private isCurrentSession(owner: number): boolean {
    return !this.#disposed && this.#sessionGeneration === owner
  }

  private adoptRecord(record: OAuthDesktopSession | null): void {
    // 初次加载不替换已有 owner；同凭据重新 parse 不代表换登录。
    if (this.#record && !sameSession(this.#record, record)) this.#sessionGeneration++
    this.#record = record
  }

  private clearSession(
    owner: number,
    record: OAuthDesktopSession | null,
    terminal?: "ACCOUNT_BANNED" | "DEVICE_REVOKED",
  ): Promise<MembershipView> {
    return this.mutate(async () => {
      if (!this.isCurrentSession(owner)) return this.view()
      if (record) await this.#deleteLocalSecrets(record.userId)
      if (!this.isCurrentSession(owner)) return this.view()
      this.#record = null
      this.#sessionGeneration++
      return this.publish(
        terminal
          ? this.withState(
              initialView(),
              terminal === "DEVICE_REVOKED" ? "device_revoked" : "verification_required",
              terminal,
            )
          : signedOutView(),
      )
    })
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.#readGeneration++
    const pending = this.#mutation.then(async () => {
      try {
        return await operation()
      } finally {
        this.#readGeneration++
      }
    })
    this.#mutation = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  private normalizeRemote(view: MembershipView): MembershipView {
    const serverState = view.state as string
    if (serverState === "inactive" || serverState === "revoked") {
      return this.withState(view, "verification_required", "AUTHORIZATION_UNAUTHORIZED")
    }
    return {
      ...view,
      startupPhase: "settled",
      lastVerifiedAt: view.lastVerifiedAt ?? new Date(this.#now()).toISOString(),
    }
  }

  private withState(
    view: MembershipView,
    state: MembershipView["state"],
    errorCode: DesktopMembershipErrorCode | string,
  ): MembershipView {
    return { ...view, state, errorCode, serverReason: view.serverReason ?? errorCode }
  }

  private publish(view: MembershipView): MembershipView {
    if (this.#disposed) return this.view()
    this.#revision = Math.max(this.#revision + 1, view.revision)
    this.#view = { ...view, revision: this.#revision, startupPhase: "settled" }
    const safe = this.view()
    for (const listener of this.#listeners) listener(safe)
    return safe
  }

  async #deleteLocalSecrets(accountId?: string): Promise<void> {
    if (this.#vault.deletePrefix) {
      await this.#vault.deletePrefix("authorization:pigclaude-login:")
    } else if (accountId) {
      await this.#vault.delete(`authorization:pigclaude-login:${accountId}`)
    }
    await this.#vault.delete("membership:session")
  }
}

function initialView(): MembershipView {
  return {
    startupPhase: "checking",
    revision: 0,
    state: "connecting",
    account: null,
    productCode: null,
    planKind: null,
    lifetime: false,
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

function sameSession(left: OAuthDesktopSession, right: OAuthDesktopSession | null): boolean {
  return (
    right !== null &&
    left.userId === right.userId &&
    left.deviceId === right.deviceId &&
    left.bindingEpoch === right.bindingEpoch &&
    left.authVersion === right.authVersion &&
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.scope === right.scope &&
    left.accessTokenExpiresAt === right.accessTokenExpiresAt &&
    left.refreshTokenExpiresAt === right.refreshTokenExpiresAt
  )
}

function errorCodeOf(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
