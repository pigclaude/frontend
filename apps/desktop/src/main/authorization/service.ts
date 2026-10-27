// 负责维护授权会话、校验回调并把交换出的秘密交给安全仓库。
import {
  buildAuthorizationUrl,
  createAuthorizationSession,
  validateAuthorizationCallback,
} from "./pkce"
import type {
  AuthorizationCallback,
  AuthorizationRequest,
  AuthorizationSession,
  AuthorizationStateEvent,
  AuthorizationToken,
} from "./types"
import type { SecretVault } from "../secret-vault"
import { DeviceIdentityService } from "../device-identity"
import { readDeviceInfo, type DeviceInfo } from "../device-identity/device-info"
import type { DeviceAuthorizationInput, DeviceAuthorizationContext } from "../api/oauth-client"
import { NATIVE_SCOPES } from "../api/oauth-client"

/** 授权码交换所需的主进程参数，保证 verifier 不离开主进程。 */
export type AuthorizationExchange = {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
  session: AuthorizationSession
}

/** 标准 native context 准备端口，verifier 始终留在主进程。 */
export type AuthorizationStart = (
  input: DeviceAuthorizationInput,
) => Promise<DeviceAuthorizationContext>

/** 授权服务依赖，保证网络和秘密存储可在测试中替换。 */
export type AuthorizationServiceOptions = {
  authOrigin: string
  vault: SecretVault
  exchangeCode: (input: AuthorizationExchange) => Promise<AuthorizationToken>
  /** 配置后第一方登录使用标准 OAuth context。 */
  startAuthorization?: AuthorizationStart
  /** 设备身份只由主进程平台服务读取，不从 renderer 或旧仓库恢复。 */
  deviceIdentity?: Pick<DeviceIdentityService, "read">
  /** 电脑名、系统版本和应用版本读取，默认读取当前系统。 */
  deviceInfo?: () => Promise<DeviceInfo>
  /** Rust exchange 完成后把脱敏设备元数据交给会员 gate。 */
  onCompleted?: (input: {
    session: AuthorizationSession
    token: AuthorizationToken
  }) => Promise<void>
  /** 候选授权未提交时重新核验原登录，不把本机旧材料当作有效权限。 */
  onAbandoned?: (session: AuthorizationSession) => Promise<void>
  /** 保存临界区开始时通知页面；此后普通取消不打断原子写入。 */
  onProgress?: (event: AuthorizationStateEvent) => void
  /** 独立 Claude provider 端口，不消费第一方 grant。 */
  claudeAuthorization?: ClaudeAuthorizationAdapter
  /** 仅执行本机写入；与现有 writer fence 同步，不得进行网络请求。 */
  commitAuthorization?: (input: {
    token: AuthorizationToken
    isCurrent: () => boolean
  }) => Promise<void>
  now?: () => number
}

/** Claude provider 使用自己的准备和兑换端口，不能复用第一方 OAuth。 */
export type ClaudeAuthorizationAdapter = {
  /** 仅在独立 provider 准备授权，不调用第一方 context。 */
  start(session: AuthorizationSession): Promise<{ authorizationUrl: string; expiresAt: number }>
  /** 将独立 provider code 兑换为 Claude credential，不重解释第一方 token。 */
  exchangeCode(input: AuthorizationExchange): Promise<AuthorizationToken>
}

/** 创建授权会话失败时携带的可见状态。 */
export class AuthorizationStartError extends Error {
  readonly status: "proxy-mismatch" | "cancelled"

  /** 创建带有业务状态的授权启动错误。 */
  constructor(status: "proxy-mismatch" | "cancelled", message: string) {
    super(message)
    this.name = "AuthorizationStartError"
    this.status = status
  }
}

/** 主进程授权会话服务，保证一次只消费一个短时授权会话。 */
export class AuthorizationService {
  readonly #authOrigin: string
  readonly #vault: SecretVault
  readonly #exchangeCode: AuthorizationServiceOptions["exchangeCode"]
  readonly #startAuthorization: AuthorizationServiceOptions["startAuthorization"]
  readonly #deviceIdentity: Pick<DeviceIdentityService, "read">
  readonly #deviceInfo: () => Promise<DeviceInfo>
  readonly #onCompleted: NonNullable<AuthorizationServiceOptions["onCompleted"]>
  readonly #onAbandoned: AuthorizationServiceOptions["onAbandoned"]
  readonly #onProgress: AuthorizationServiceOptions["onProgress"]
  readonly #claudeAuthorization: AuthorizationServiceOptions["claudeAuthorization"]
  readonly #commitAuthorization: AuthorizationServiceOptions["commitAuthorization"]
  readonly #now: () => number
  #activeSession: AuthorizationSession | null = null
  #pendingSession: AuthorizationSession | null = null
  #committingSession: AuthorizationSession | null = null
  #generation = 0
  #suspended = false
  #localWrites: Promise<void> = Promise.resolve()

  /** 创建绑定授权服务 origin 和秘密仓库的会话服务。 */
  constructor(options: AuthorizationServiceOptions) {
    this.#claudeAuthorization = options.claudeAuthorization
    this.#commitAuthorization = options.commitAuthorization
    this.#authOrigin = options.authOrigin
    this.#vault = options.vault
    this.#exchangeCode = options.exchangeCode
    this.#startAuthorization = options.startAuthorization
    this.#deviceIdentity = options.deviceIdentity ?? new DeviceIdentityService()
    this.#deviceInfo = options.deviceInfo ?? readDeviceInfo
    this.#onCompleted = options.onCompleted ?? (async () => undefined)
    this.#onAbandoned = options.onAbandoned
    this.#onProgress = options.onProgress
    this.#now = options.now ?? Date.now
  }

  /** 创建授权 URL，出口不一致时保证不会打开浏览器。 */
  async start(
    request: AuthorizationRequest,
    redirectUri: string,
  ): Promise<{ sessionId: string; authorizationUrl: string; expiresAt: number }> {
    if (this.#suspended) throw new AuthorizationStartError("cancelled", "本机授权已暂停")
    if (this.#committingSession)
      throw new AuthorizationStartError("cancelled", "正在保存授权，请稍候")
    if (
      request.purpose === "claude-account" &&
      (!request.bridgeExit || request.bridgeExit !== request.daemonExit)
    ) {
      throw new AuthorizationStartError("proxy-mismatch", "登录桥和 daemon 的出口不一致")
    }
    const session = createAuthorizationSession({ request, redirectUri, now: this.#now() })
    const generation = ++this.#generation
    this.#activeSession = null
    this.#pendingSession = session
    try {
      if (request.purpose === "claude-account" && this.#claudeAuthorization) {
        const started = await this.#claudeAuthorization.start(session)
        if (!this.isCurrent(generation))
          throw new AuthorizationStartError("cancelled", "授权会话已取消")
        session.expiresAt = Math.min(session.expiresAt, started.expiresAt)
        this.#activeSession = session
        return {
          sessionId: session.sessionId,
          authorizationUrl: started.authorizationUrl,
          expiresAt: session.expiresAt,
        }
      }
      if (request.purpose === "pigclaude-login" && this.#startAuthorization) {
        let identity: Awaited<ReturnType<DeviceIdentityService["read"]>>
        let deviceInfo: DeviceInfo
        ;[identity, deviceInfo] = await Promise.all([
          this.#deviceIdentity.read(),
          this.#deviceInfo(),
        ])
        if (!this.isCurrent(generation)) {
          throw new AuthorizationStartError("cancelled", "授权会话已取消")
        }
        const started = await this.#startAuthorization({
          deviceId: identity.deviceId,
          platform: identity.platform,
          name: deviceInfo.name,
          osVersion: deviceInfo.osVersion,
          appVersion: deviceInfo.appVersion,
          scopes: NATIVE_SCOPES,
          codeChallenge: session.codeChallenge,
          state: session.state,
          clientId: "pigclaude-desktop",
          redirectUri,
        })
        if (!this.isCurrent(generation)) {
          throw new AuthorizationStartError("cancelled", "授权会话已取消")
        }
        const deadline = Date.parse(started.expiresAt)
        if (!Number.isFinite(deadline) || deadline <= this.#now())
          throw new Error("授权上下文已过期")
        session.expiresAt = Math.min(session.expiresAt, deadline)
        this.#activeSession = session
        return {
          sessionId: session.sessionId,
          // 标准 context URL 已由 API 精确核验；只在主进程为显式切换补充受支持的账号确认意图。
          authorizationUrl:
            request.mode === "switch"
              ? accountChoiceUrl(started.authorizationUrl)
              : started.authorizationUrl,
          expiresAt: session.expiresAt,
        }
      }
      this.#activeSession = session
      return {
        sessionId: session.sessionId,
        authorizationUrl: buildAuthorizationUrl(session, this.#authOrigin),
        expiresAt: session.expiresAt,
      }
    } catch (error: unknown) {
      if (this.isCurrent(generation) && this.#pendingSession === session)
        await this.cancel(session.sessionId)
      throw error
    }
  }

  /** 处理回环或私有协议回调，只把脱敏结果返回给 renderer。 */
  async handleCallback(url: string): Promise<AuthorizationStateEvent> {
    const session = this.#activeSession
    if (!session) return unknownSessionEvent("state-mismatch", "没有等待中的授权会话")
    const generation = this.#generation

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return this.failureEvent(session, "state-mismatch", "回调地址无效")
    }
    if (!matchesRedirect(parsed, session.redirectUri, url)) {
      return this.failureEvent(session, "state-mismatch", "回调地址与授权会话不匹配")
    }

    const callback = readCallback(parsed.searchParams)
    const validation = validateAuthorizationCallback(session, callback, this.#now())
    if (!validation.ok) {
      if (validation.reason !== "state-mismatch") {
        this.#activeSession = null
        this.#pendingSession = null
        await this.#onAbandoned?.(session)
        if (!this.isCurrent(generation)) return this.failureEvent(session, "cancelled")
      }
      return this.failureEvent(session, validation.reason)
    }

    session.consumed = true
    this.#activeSession = null
    try {
      const exchange =
        session.request.purpose === "claude-account" && this.#claudeAuthorization
          ? (input: AuthorizationExchange) => this.#claudeAuthorization!.exchangeCode(input)
          : this.#exchangeCode
      const token = await exchange({
        code: callback.code ?? "",
        codeVerifier: session.codeVerifier,
        redirectUri: session.redirectUri,
        clientId: "pigclaude-desktop",
        session,
      })
      if (!this.isCurrent(generation)) return this.failureEvent(session, "cancelled")
      if (
        token.purpose !== session.request.purpose ||
        (session.request.purpose === "claude-account" && token.oauthSession) ||
        (token.oauthSession && token.credential)
      )
        throw new Error("授权用途不匹配")
      const secret = {
        ...(token.accessToken ? { accessToken: token.accessToken } : {}),
        ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
        ...(token.credential ? { credential: token.credential } : {}),
        expiresAt: token.expiresAt,
      }
      const writing = this.#localWrites.then(async () => {
        if (!this.isCurrent(generation)) return
        if (token.oauthSession) {
          this.#committingSession = session
          this.#onProgress?.(this.commitEvent(session))
        }
        if (!token.oauthSession && Object.keys(secret).length > 1) {
          await this.#vault.set(secretKey(token), JSON.stringify(secret))
        }
        if (this.isCurrent(generation)) {
          await this.#commitAuthorization?.({ token, isCurrent: () => this.isCurrent(generation) })
        }
      })
      this.#localWrites = writing.catch(() => undefined)
      await writing
      if (!this.isCurrent(generation)) return this.failureEvent(session, "cancelled")
      await this.#onCompleted({ session, token })
      if (!this.isCurrent(generation)) return this.failureEvent(session, "cancelled")
      this.#pendingSession = null
      return {
        sessionId: session.sessionId,
        purpose: session.request.purpose,
        mode: session.request.mode,
        status: "completed",
        accountId: token.accountId,
        displayName: token.displayName,
        expiresAt: token.expiresAt,
      }
    } catch (error: unknown) {
      if (!this.isCurrent(generation)) return this.failureEvent(session, "cancelled")
      const storageFailed =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "SAFE_STORAGE_UNAVAILABLE"
      await this.#onAbandoned?.(session)
      if (!this.isCurrent(generation)) return this.failureEvent(session, "cancelled")
      return this.failureEvent(
        session,
        "exchange-error",
        storageFailed
          ? "SAFE_STORAGE_UNAVAILABLE：系统安全存储不可用，授权未保存"
          : "授权码交换失败",
      )
    } finally {
      if (this.#committingSession === session) this.#committingSession = null
    }
  }

  /** 按会话或 UI 请求标识取消对应候选，准备阶段也能立即失效。 */
  async cancel(sessionId: string): Promise<AuthorizationStateEvent> {
    const session = this.#pendingSession
    if (
      !session ||
      (session.sessionId !== sessionId && session.request.clientRequestId !== sessionId)
    ) {
      return unknownSessionEvent("cancelled", "授权会话已结束")
    }
    if (this.#committingSession === session) return this.commitEvent(session)
    this.#generation++
    this.#activeSession = null
    this.#pendingSession = null
    await this.#onAbandoned?.(session)
    return {
      sessionId: session.sessionId,
      purpose: session.request.purpose,
      mode: session.request.mode,
      status: "cancelled",
    }
  }

  /** 返回当前待处理会话，供回调和单实例唤醒使用。 */
  getActiveSession(): AuthorizationSession | null {
    return this.#activeSession
  }

  /** 同步失效开始、交换和回调，只等待已进入本机仓库的写入完成。 */
  suspend(): Promise<void> {
    this.#generation++
    this.#suspended = true
    this.#activeSession = null
    this.#pendingSession = null
    this.#committingSession = null
    return this.#localWrites
  }

  /** 本机清理成功后允许创建全新授权，不恢复已取消的旧会话。 */
  resume(): void {
    this.#suspended = false
  }

  private isCurrent(generation: number): boolean {
    return !this.#suspended && generation === this.#generation
  }

  private commitEvent(session: AuthorizationSession): AuthorizationStateEvent {
    return {
      sessionId: session.sessionId,
      purpose: session.request.purpose,
      mode: session.request.mode,
      status: "committing",
    }
  }

  private failureEvent(
    session: AuthorizationSession,
    reason: AuthorizationStateEvent["status"] | "missing-code" | "already-consumed",
    error?: string,
  ): AuthorizationStateEvent {
    const status =
      reason === "missing-code" || reason === "already-consumed" ? "state-mismatch" : reason
    return {
      sessionId: session.sessionId,
      purpose: session.request.purpose,
      mode: session.request.mode,
      status,
      error: error ?? statusMessage(status),
    }
  }
}

function readCallback(search: URLSearchParams): AuthorizationCallback {
  return {
    code: search.get("code") ?? undefined,
    state: search.get("state") ?? undefined,
    error: search.get("error") ?? undefined,
    errorDescription: search.get("error_description") ?? undefined,
  }
}

function matchesRedirect(url: URL, redirectUri: string, raw: string): boolean {
  const expected = new URL(redirectUri)
  return (
    raw.split(/[?#]/, 1)[0] === redirectUri &&
    !raw.includes("#") &&
    !url.username &&
    !url.password &&
    !url.hash &&
    [...url.searchParams.keys()].every(
      (key) =>
        ["code", "state", "error", "error_description"].includes(key) &&
        url.searchParams.getAll(key).length === 1,
    ) &&
    url.protocol === expected.protocol &&
    url.host === expected.host &&
    url.pathname === expected.pathname
  )
}

function secretKey(token: AuthorizationToken): string {
  return `authorization:${token.purpose}:${token.accountId}`
}

function unknownSessionEvent(
  status: "state-mismatch" | "cancelled",
  error: string,
): AuthorizationStateEvent {
  return {
    sessionId: "",
    purpose: "pigclaude-login",
    mode: "login",
    status,
    error,
  }
}

function statusMessage(status: AuthorizationStateEvent["status"]): string {
  const messages: Partial<Record<AuthorizationStateEvent["status"], string>> = {
    "state-mismatch": "授权回调校验失败",
    denied: "浏览器拒绝了授权",
    expired: "授权链接已过期",
    "proxy-mismatch": "登录出口不一致",
    "exchange-error": "授权码交换失败",
  }
  return messages[status] ?? "授权失败"
}

function accountChoiceUrl(value: string): string {
  const url = new URL(value)
  url.searchParams.set("prompt", "consent")
  return url.toString()
}
