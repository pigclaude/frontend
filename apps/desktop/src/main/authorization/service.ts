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

/** 授权码交换所需的主进程参数，保证 verifier 不离开主进程。 */
export type AuthorizationExchange = {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
  session: AuthorizationSession
}

/** 授权服务依赖，保证网络和秘密存储可在测试中替换。 */
export type AuthorizationServiceOptions = {
  authOrigin: string
  vault: SecretVault
  exchangeCode: (input: AuthorizationExchange) => Promise<AuthorizationToken>
  now?: () => number
}

/** 创建授权会话失败时携带的可见状态。 */
export class AuthorizationStartError extends Error {
  readonly status: "proxy-mismatch"

  /** 创建带有业务状态的授权启动错误。 */
  constructor(status: "proxy-mismatch", message: string) {
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
  readonly #now: () => number
  #activeSession: AuthorizationSession | null = null

  /** 创建绑定授权服务 origin 和秘密仓库的会话服务。 */
  constructor(options: AuthorizationServiceOptions) {
    this.#authOrigin = options.authOrigin
    this.#vault = options.vault
    this.#exchangeCode = options.exchangeCode
    this.#now = options.now ?? Date.now
  }

  /** 创建授权 URL，出口不一致时保证不会打开浏览器。 */
  async start(
    request: AuthorizationRequest,
    redirectUri: string,
  ): Promise<{ sessionId: string; authorizationUrl: string; expiresAt: number }> {
    if (
      request.purpose === "claude-account" &&
      (!request.bridgeExit || request.bridgeExit !== request.daemonExit)
    ) {
      throw new AuthorizationStartError("proxy-mismatch", "登录桥和 daemon 的出口不一致")
    }
    const session = createAuthorizationSession({ request, redirectUri, now: this.#now() })
    this.#activeSession = session
    return {
      sessionId: session.sessionId,
      authorizationUrl: buildAuthorizationUrl(session, this.#authOrigin),
      expiresAt: session.expiresAt,
    }
  }

  /** 处理回环或私有协议回调，只把脱敏结果返回给 renderer。 */
  async handleCallback(url: string): Promise<AuthorizationStateEvent> {
    const session = this.#activeSession
    if (!session) return unknownSessionEvent("state-mismatch", "没有等待中的授权会话")

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return this.failureEvent(session, "state-mismatch", "回调地址无效")
    }
    if (!matchesRedirect(parsed, session.redirectUri)) {
      return this.failureEvent(session, "state-mismatch", "回调地址与授权会话不匹配")
    }

    const callback = readCallback(parsed.searchParams)
    const validation = validateAuthorizationCallback(session, callback, this.#now())
    if (!validation.ok) {
      if (validation.reason !== "state-mismatch") this.#activeSession = null
      return this.failureEvent(session, validation.reason, callback.errorDescription)
    }

    session.consumed = true
    this.#activeSession = null
    try {
      const token = await this.#exchangeCode({
        code: callback.code ?? "",
        codeVerifier: session.codeVerifier,
        redirectUri: session.redirectUri,
        clientId: "pigclaude-desktop",
        session,
      })
      await this.#vault.set(
        secretKey(token),
        JSON.stringify({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          credential: token.credential,
          expiresAt: token.expiresAt,
        }),
      )
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
      return this.failureEvent(session, "exchange-error", errorMessage(error))
    }
  }

  /** 取消当前会话并返回取消状态。 */
  async cancel(sessionId: string): Promise<AuthorizationStateEvent> {
    const session = this.#activeSession
    if (!session || session.sessionId !== sessionId) {
      return unknownSessionEvent("cancelled", "授权会话已结束")
    }
    this.#activeSession = null
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

function matchesRedirect(url: URL, redirectUri: string): boolean {
  const expected = new URL(redirectUri)
  return (
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权码交换失败"
}
