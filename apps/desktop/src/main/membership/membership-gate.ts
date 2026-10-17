// 负责以 Rust 服务端为权威检查本机会员与设备绑定，并隔离 safeStorage 秘密。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  DesktopMembershipErrorCode,
  MembershipInspectRequest,
  MembershipSessionRecord,
} from "@pigclaude/contracts/desktop-membership"
import type { SecretVault } from "../secret-vault"

/** MembershipGate 调用的最小 API 端口，不允许 gate 依赖 Electron 或 HTTP 实现。 */
export type MembershipGateApi = {
  inspectMembership(input: MembershipInspectRequest): Promise<MembershipView>
  revokeDevice(input: { deviceId: string }): Promise<void>
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
  #record: MembershipSessionRecord | null = null
  #view: MembershipView = initialView()
  #revision = 0

  /** 创建只依赖 API、时钟和安全仓库的会员门禁。 */
  constructor(options: MembershipGateOptions) {
    this.#api = options.api
    this.#vault = options.vault
    this.#now = options.now ?? Date.now
  }

  /** 从 safeStorage 恢复设备材料并重新向 Rust 检查会员状态。 */
  async inspect(): Promise<MembershipView> {
    let raw: string | null
    try {
      raw = await this.#vault.get("membership:session")
    } catch {
      return this.publish(
        this.withState(initialView(), "configuration_error", "SAFE_STORAGE_UNAVAILABLE"),
      )
    }
    const record = parseRecord(raw)
    this.#record = record
    if (!record) return this.publish(signedOutView())
    try {
      const remote = await this.#api.inspectMembership({
        deviceId: record.deviceId,
        bindingEpoch: record.bindingEpoch,
      })
      if (
        remote.bindingEpoch !== null &&
        record.bindingEpoch !== "" &&
        remote.bindingEpoch !== record.bindingEpoch
      ) {
        return this.publish(this.withState(remote, "device_revoked", "AUTHORIZATION_BINDING_STALE"))
      }
      return this.publish(this.normalizeRemote(remote))
    } catch (error: unknown) {
      const errorCode = errorCodeOf(error, "SERVER_UNAVAILABLE")
      const state =
        errorCode === "AUTHORIZATION_DEVICE_REVOKED" || errorCode === "AUTHORIZATION_BINDING_STALE"
          ? "device_revoked"
          : errorCode === "AUTHORIZATION_EXPIRED"
            ? "expired"
            : errorCode === "AUTHORIZATION_UNAUTHORIZED"
              ? "verification_required"
              : "error"
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

  /** 撤销服务端设备后清理本机授权材料并广播 signed_out。 */
  async revoke(): Promise<MembershipView> {
    const record = this.#record ?? parseRecord(await this.#vault.get("membership:session"))
    if (record) {
      await this.#api.revokeDevice({ deviceId: record.deviceId })
      await this.#deleteLocalSecrets(record.accountId)
    }
    this.#record = null
    return this.publish(signedOutView())
  }

  /** 授权交换完成后写入仅供主进程恢复使用的设备元数据。 */
  async acceptAuthorization(input: {
    deviceId: string
    bindingEpoch: string
    accountId?: string
    accessToken?: string
    refreshToken?: string
    credential?: string
    sessionCookie?: string
  }): Promise<void> {
    const record: MembershipSessionRecord = {
      deviceId: input.deviceId,
      bindingEpoch: input.bindingEpoch,
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.accessToken ? { accessToken: input.accessToken } : {}),
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      ...(input.credential ? { credential: input.credential } : {}),
      ...(input.sessionCookie ? { sessionCookie: input.sessionCookie } : {}),
    }
    await this.#vault.set("membership:session", JSON.stringify(record))
    this.#record = record
  }

  /** 释放 gate 订阅，供 composition 的 ordered cleanup 使用。 */
  dispose(): void {
    this.#listeners.clear()
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
    this.#revision = Math.max(this.#revision + 1, view.revision)
    this.#view = { ...view, revision: this.#revision, startupPhase: "settled" }
    const safe = this.view()
    for (const listener of this.#listeners) listener(safe)
    return safe
  }

  async #deleteLocalSecrets(accountId?: string): Promise<void> {
    if (this.#vault.deletePrefix) {
      await this.#vault.deletePrefix("authorization:")
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

function parseRecord(value: string | null): MembershipSessionRecord | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || typeof parsed.deviceId !== "string") return null
    if (typeof parsed.bindingEpoch !== "string") return null
    return {
      deviceId: parsed.deviceId,
      bindingEpoch: parsed.bindingEpoch,
      accountId: typeof parsed.accountId === "string" ? parsed.accountId : undefined,
      accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : undefined,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      credential: typeof parsed.credential === "string" ? parsed.credential : undefined,
      sessionCookie: typeof parsed.sessionCookie === "string" ? parsed.sessionCookie : undefined,
    }
  } catch {
    return null
  }
}

function errorCodeOf(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
