// 负责 Claude 订阅账号的官方 OAuth：授权 URL、本机回调、code 交换、refresh 和 profile 读取。

import { randomBytes } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { sendCompletionPage } from "../authorization/completion-page"
import { createPkceChallenge } from "../authorization/pkce"
import { fetch as undiciFetch } from "undici"
import {
  oauthRequestSignal,
  requestOAuth,
  type OAuthRequestNetwork,
} from "./subscription-oauth-request"
import { callbackStateMatches, listenCallbackServer } from "./subscription-oauth-callback-support"

const defaultAuthorizeUrl = "https://claude.com/cai/oauth/authorize"
const defaultTokenUrl = "https://platform.claude.com/v1/oauth/token"
const defaultProfileUrl = "https://api.anthropic.com/api/oauth/profile"
const defaultClientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const defaultScopes = [
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
]
const defaultTimeoutMs = 15_000
const defaultCallbackTimeoutMs = 10 * 60 * 1_000

/** Claude 订阅 OAuth 的稳定错误码。 */
export type SubscriptionOAuthErrorCode =
  | "OAUTH_STATE_MISMATCH"
  | "OAUTH_DENIED"
  | "OAUTH_EXCHANGE_FAILED"
  | "AUTHORIZATION_TIMEOUT"
  | "AUTHORIZATION_CANCELLED"
  | "CREDENTIAL_REFRESH_FAILED"

/** Claude 订阅 OAuth 错误。invalidGrant 用来区分需要重新授权的情况。 */
export class SubscriptionOAuthError extends Error {
  readonly code: SubscriptionOAuthErrorCode
  readonly invalidGrant: boolean

  /** 创建带稳定错误码的 OAuth 错误。 */
  constructor(code: SubscriptionOAuthErrorCode, message: string, invalidGrant = false) {
    super(message)
    this.name = "SubscriptionOAuthError"
    this.code = code
    this.invalidGrant = invalidGrant
  }
}

/** 一次 OAuth 请求的 PKCE 和 state 材料。 */
export type SubscriptionOAuthRequest = {
  state: string
  codeVerifier: string
  codeChallenge: string
}

/** 一次成功交换或刷新后的 token 集合。 */
export type ClaudeOAuthTokens = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
}

/** 从 profile 端点读到的账号元数据。 */
export type ClaudeOAuthProfile = {
  accountUuid: string | null
  email: string | null
  organizationUuid: string | null
  subscriptionType: string | null
  rateLimitTier: string | null
}

/** 正在等待回调的本机服务器。 */
export type OAuthCallbackServer = {
  redirectUri: string
  waitForCode: () => Promise<string>
  /** 结束等待，但保留回调监听直到浏览器退出。 */
  cancel: () => void
  close: () => Promise<void>
}

type OAuthConfig = {
  authorizeUrl: string
  tokenUrl: string
  profileUrl: string
  clientId: string
  scopes: string[]
  timeoutMs: number
  now: () => number
  fetch: typeof undiciFetch
}

type CallbackOutcome =
  | { kind: "code"; code: string }
  | { kind: "error"; code: SubscriptionOAuthErrorCode; message: string }

/** 生成一次 OAuth 请求的 state 和 S256 PKCE 对。 */
export function createSubscriptionOAuthRequest(): SubscriptionOAuthRequest {
  const verifier = randomBytes(48).toString("base64url")
  return {
    state: randomBytes(32).toString("base64url"),
    codeVerifier: verifier,
    codeChallenge: createPkceChallenge(verifier),
  }
}

/** Claude 订阅 OAuth 客户端。保证所有请求可注入 dispatcher，错误不包含 token 或 code。 */
export class SubscriptionOAuth {
  readonly #config: OAuthConfig

  /** 创建使用固定第一方公共客户端参数的 OAuth 客户端。 */
  constructor(
    options: {
      authorizeUrl?: string
      tokenUrl?: string
      profileUrl?: string
      clientId?: string
      scopes?: string[]
      timeoutMs?: number
      now?: () => number
      fetch?: typeof undiciFetch
    } = {},
  ) {
    this.#config = {
      authorizeUrl: options.authorizeUrl ?? defaultAuthorizeUrl,
      tokenUrl: options.tokenUrl ?? defaultTokenUrl,
      profileUrl: options.profileUrl ?? defaultProfileUrl,
      clientId: options.clientId ?? defaultClientId,
      scopes: options.scopes ?? [...defaultScopes],
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
      now: options.now ?? Date.now,
      fetch: options.fetch ?? undiciFetch,
    }
  }

  /** 生成官方授权 URL，不包含 verifier。 */
  buildAuthorizeUrl(input: { redirectUri: string; state: string; codeChallenge: string }): string {
    const url = new URL(this.#config.authorizeUrl)
    url.searchParams.set("code", "true")
    url.searchParams.set("client_id", this.#config.clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", input.redirectUri)
    url.searchParams.set("scope", this.#config.scopes.join(" "))
    url.searchParams.set("code_challenge", input.codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", input.state)
    return url.toString()
  }

  /** 启动同时监听 IPv4/IPv6 的本机回调服务器。保证 state 只消费一次。 */
  async startCallback(input: { state: string; timeoutMs?: number }): Promise<OAuthCallbackServer> {
    const result = createCallbackState()
    const servers: Server[] = []
    const handler = (request: IncomingMessage, response: ServerResponse): void => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== "/callback") {
        response.writeHead(404)
        response.end()
        return
      }
      if (result.isComplete()) {
        sendCompletionPage(response, {
          kind: "error",
          title: "授权已结束",
          message: "本次授权已结束，请回到 PigClaude。",
          hint: "如需授权，请重新开始。",
        })
        return
      }
      const error = url.searchParams.get("error")
      if (error !== null) {
        sendCompletionPage(response, {
          kind: "error",
          title: "授权未完成",
          message: "授权被拒绝，请回到 PigClaude 重新发起。",
          hint: "如果问题持续，请重新发起授权。",
        })
        result.complete({ kind: "error", code: "OAUTH_DENIED", message: "授权被拒绝" })
        return
      }
      const state = url.searchParams.get("state") ?? ""
      const code = url.searchParams.get("code")
      if (!callbackStateMatches(state, input.state)) {
        sendCompletionPage(response, {
          kind: "error",
          title: "授权未完成",
          message: "授权校验失败，请回到 PigClaude 重新开始。",
          hint: "不要关闭 PigClaude，回到应用重新发起授权。",
        })
        result.complete({
          kind: "error",
          code: "OAUTH_STATE_MISMATCH",
          message: "授权 state 不匹配",
        })
        return
      }
      if (code === null || code === "") {
        sendCompletionPage(response, {
          kind: "error",
          title: "授权未完成",
          message: "授权缺少 code，请回到 PigClaude 重新开始。",
          hint: "不要关闭 PigClaude，回到应用重新发起授权。",
        })
        result.complete({
          kind: "error",
          code: "OAUTH_EXCHANGE_FAILED",
          message: "授权回调缺少 code",
        })
        return
      }
      sendCompletionPage(response, {
        kind: "success",
        title: "授权完成",
        message: "PigClaude 已收到 Claude 账号授权，可以关闭此页面继续。",
        hint: "如果没有自动切回，请手动关闭此标签页。",
      })
      result.complete({ kind: "code", code })
    }

    const ipv4 = createServer(handler)
    const port = await listenCallbackServer(ipv4, "127.0.0.1")
    servers.push(ipv4)
    const ipv6 = createServer(handler)
    try {
      await listenCallbackServer(ipv6, "::1", port)
      servers.push(ipv6)
    } catch {
      ipv6.close()
    }

    const timeout = setTimeout(() => {
      result.complete({
        kind: "error",
        code: "AUTHORIZATION_TIMEOUT",
        message: "授权超时",
      })
    }, input.timeoutMs ?? defaultCallbackTimeoutMs)
    timeout.unref?.()

    let closing: Promise<void> | undefined
    return {
      redirectUri: `http://localhost:${port}/callback`,
      waitForCode: () => result.wait(),
      cancel: () =>
        result.complete({
          kind: "error",
          code: "AUTHORIZATION_CANCELLED",
          message: "授权已取消",
        }),
      close: () => {
        if (closing !== undefined) return closing
        clearTimeout(timeout)
        result.complete({
          kind: "error",
          code: "AUTHORIZATION_CANCELLED",
          message: "授权已取消",
        })
        for (const server of servers) server.closeAllConnections()
        const work = Promise.allSettled(
          servers.map(
            (server) =>
              new Promise<void>((resolve, reject) => {
                if (!server.listening) return resolve()
                server.close((error) => (error ? reject(error) : resolve()))
              }),
          ),
        ).then((results) => {
          const failure = results.find((result) => result.status === "rejected")
          if (failure?.status === "rejected") throw failure.reason
        })
        closing = work
        void work.catch(() => {
          if (closing === work) closing = undefined
        })
        return work
      },
    }
  }

  /** 用授权 code 交换 token。保证只接受完整成功响应，并使用显式指定的网络。 */
  async exchangeCode(
    input: {
      code: string
      state: string
      codeVerifier: string
      redirectUri: string
    } & OAuthRequestNetwork,
  ): Promise<ClaudeOAuthTokens> {
    return this.#requestTokens(
      {
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.#config.clientId,
        code_verifier: input.codeVerifier,
        state: input.state,
      },
      input,
      "OAUTH_EXCHANGE_FAILED",
    )
  }

  /** 用 refresh token 换新 token。保证 refresh token 轮换时保留新值。 */
  async refresh(
    input: {
      refreshToken: string
      scopes?: string[]
    } & OAuthRequestNetwork,
  ): Promise<ClaudeOAuthTokens> {
    return this.#requestTokens(
      {
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: this.#config.clientId,
        scope: (input.scopes ?? this.#config.scopes).join(" "),
      },
      input,
      "CREDENTIAL_REFRESH_FAILED",
      input.refreshToken,
    )
  }

  /** 读取账号 profile。保证失败时返回 null，不阻断凭据保存。 */
  async readProfile(
    input: {
      accessToken: string
    } & OAuthRequestNetwork,
  ): Promise<ClaudeOAuthProfile | null> {
    let response: Awaited<ReturnType<typeof requestOAuth>>
    try {
      response = await requestOAuth(
        this.#config.fetch,
        this.#config.profileUrl,
        {
          method: "GET",
          headers: { authorization: `Bearer ${input.accessToken}` },
          signal: oauthRequestSignal(this.#config.timeoutMs, input.signal),
        },
        input,
      )
    } catch {
      return null
    }
    if (!response.ok) {
      await response.discard()
      return null
    }
    let body: unknown
    try {
      body = JSON.parse(await response.text()) as unknown
    } catch {
      return null
    }
    return parseProfile(body)
  }

  async #requestTokens(
    body: Record<string, string>,
    network: OAuthRequestNetwork,
    failureCode: SubscriptionOAuthErrorCode,
    fallbackRefreshToken?: string,
  ): Promise<ClaudeOAuthTokens> {
    let response: Awaited<ReturnType<typeof requestOAuth>>
    try {
      response = await requestOAuth(
        this.#config.fetch,
        this.#config.tokenUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: oauthRequestSignal(this.#config.timeoutMs, network.signal),
        },
        network,
      )
    } catch {
      throw new SubscriptionOAuthError(failureCode, "OAuth 请求失败")
    }
    const text = await response.text().catch(() => "")
    const parsed = parseJson(text)
    if (!response.ok) {
      const invalidGrant = isRecord(parsed) && parsed.error === "invalid_grant"
      throw new SubscriptionOAuthError(
        failureCode,
        invalidGrant ? "需要重新授权" : "OAuth 请求被拒绝",
        invalidGrant,
      )
    }
    if (!isRecord(parsed)) {
      throw new SubscriptionOAuthError(failureCode, "OAuth 响应格式无效")
    }
    const accessToken = readString(parsed.access_token)
    const refreshToken = readString(parsed.refresh_token) ?? fallbackRefreshToken
    const expiresIn = parsed.expires_in
    if (
      accessToken === undefined ||
      refreshToken === undefined ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new SubscriptionOAuthError(failureCode, "OAuth 响应缺少令牌字段")
    }
    const scope = typeof parsed.scope === "string" ? parsed.scope : this.#config.scopes.join(" ")
    return {
      accessToken,
      refreshToken,
      expiresAt: this.#config.now() + expiresIn * 1_000,
      scopes: scope.split(" ").filter((item) => item !== ""),
    }
  }
}

function createCallbackState(): {
  complete: (outcome: CallbackOutcome) => void
  isComplete: () => boolean
  wait: () => Promise<string>
} {
  let outcome: CallbackOutcome | null = null
  let resolveWait: ((outcome: CallbackOutcome) => void) | null = null
  const complete = (next: CallbackOutcome): void => {
    if (outcome !== null) return
    outcome = next
    resolveWait?.(next)
    resolveWait = null
  }
  return {
    complete,
    isComplete: () => outcome !== null,
    wait: async () => {
      const resolved =
        outcome ??
        (await new Promise<CallbackOutcome>((resolve) => {
          resolveWait = resolve
        }))
      if (resolved.kind === "code") return resolved.code
      throw new SubscriptionOAuthError(resolved.code, resolved.message)
    },
  }
}

function parseProfile(value: unknown): ClaudeOAuthProfile | null {
  if (!isRecord(value)) return null
  const account = isRecord(value.account) ? value.account : {}
  const organization = isRecord(value.organization) ? value.organization : {}
  return {
    accountUuid: readString(account.uuid) ?? null,
    email: readString(account.email) ?? readString(account.email_address) ?? null,
    organizationUuid: readString(organization.uuid) ?? null,
    subscriptionType: subscriptionType(organization.organization_type),
    rateLimitTier: readString(organization.rate_limit_tier) ?? null,
  }
}

function subscriptionType(value: unknown): string | null {
  switch (value) {
    case "claude_max":
      return "max"
    case "claude_pro":
      return "pro"
    case "claude_enterprise":
      return "enterprise"
    case "claude_team":
      return "team"
    default:
      return null
  }
}

function parseJson(text: string): unknown {
  if (text === "") return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
