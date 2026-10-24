// 负责定义标准 native OAuth public client 的主进程网络边界。
import type { DevicePlatform } from "../device-identity/platform-reader"
import { MAX_ACCESS_TOKEN_SECONDS } from "@pigclaude/contracts/oauth"

/** 主进程上下文准备输入，平台只在发送 DTO 时映射。 */
export type DeviceAuthorizationInput = {
  deviceId: string
  platform: DevicePlatform
  name: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string
  scopes: readonly string[]
}
/** 服务端短期设备上下文，不包含 verifier。 */
export type DeviceAuthorizationContext = {
  contextId: string
  authorizationUrl: string
  expiresAt: string
}
/** 标准 public client 授权码兑换输入。 */
export type OAuthCodeInput = {
  clientId: string
  redirectUri: string
  code: string
  codeVerifier: string
}
/** 标准 OAuth 成功响应，不接受 ID Token 或网站 Cookie。 */
export type NativeOAuthToken = {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  refresh_token: string
  scope: string
}
/** 受保护 session 的四个无损字符串。 */
export type DesktopSessionView = {
  userId: string
  deviceId: string
  bindingEpoch: string
  authVersion: string
}
/** 网络与令牌来源可替换，秘密只能由主进程提供。 */
export type OAuthClientOptions = {
  baseUrl: string
  authorizationOrigin?: string
  fetcher?: typeof fetch
  accessToken?: () => Promise<string | null>
}
/** native 客户端允许申请的精确 scope 上限。 */
export const NATIVE_SCOPES = [
  "user:read",
  "membership:read",
  "device:inspect",
  "device:revoke",
] as const

/** API 固定错误保留协议 error，只有白名单 app_error 可接管业务 code。 */
export class PigclaudeApiError extends Error {
  /** 构造不会包含远端 message 或 token 的安全错误。 */
  constructor(
    readonly code: string,
    readonly status: number | null,
    readonly oauthError?: string,
  ) {
    super(code)
    this.name = "PigclaudeApiError"
  }
}

/** 标准 native OAuth 客户端，所有凭据仅在主进程处理。 */
export class OAuthClient {
  readonly #baseUrl: URL
  readonly #authorizationOrigin: URL
  readonly #fetcher: typeof fetch
  readonly #accessToken: OAuthClientOptions["accessToken"]

  /** 创建绑定可信 API 与 issuer origin 的客户端。 */
  constructor(options: OAuthClientOptions) {
    this.#baseUrl = httpUrl(options.baseUrl)
    this.#authorizationOrigin = httpUrl(options.authorizationOrigin ?? options.baseUrl)
    this.#fetcher = options.fetcher ?? fetch
    this.#accessToken = options.accessToken
  }

  /** 准备服务端设备上下文，平台映射不影响 HMAC namespace。 */
  async prepareDeviceAuthorization(
    input: DeviceAuthorizationInput,
  ): Promise<DeviceAuthorizationContext> {
    if (
      input.clientId !== "pigclaude-desktop" ||
      input.scopes.length !== NATIVE_SCOPES.length ||
      new Set(input.scopes).size !== NATIVE_SCOPES.length ||
      NATIVE_SCOPES.some((scope) => !input.scopes.includes(scope))
    ) {
      throw new PigclaudeApiError("invalid_scope", null)
    }
    const platform = { darwin: "macos", win32: "windows", linux: "linux" }[input.platform]
    const response = await this.request("/v1/desktop/oauth/contexts", {
      method: "POST",
      body: JSON.stringify({
        deviceId: input.deviceId,
        platform,
        name: input.name,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        state: input.state,
        scopes: input.scopes,
      }),
      contentType: "application/json",
    })
    if (
      !isRecord(response) ||
      !nonempty(response.contextId) ||
      !nonempty(response.authorizationUrl) ||
      typeof response.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(response.expiresAt))
    ) {
      throw invalidResponse()
    }
    const url = new URL(response.authorizationUrl, this.#authorizationOrigin)
    if (
      url.origin !== this.#authorizationOrigin.origin ||
      url.pathname !== "/oauth2/authorize" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.get("device_context") !== response.contextId
    ) {
      throw invalidResponse()
    }
    const expected: Record<string, string> = {
      response_type: "code",
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      state: input.state,
      scope: input.scopes.join(" "),
      device_context: response.contextId,
    }
    if (
      [...url.searchParams.keys()].length !== Object.keys(expected).length ||
      Object.entries(expected).some(
        ([key, value]) =>
          url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value,
      )
    ) {
      throw invalidResponse()
    }
    return {
      contextId: response.contextId,
      authorizationUrl: url.toString(),
      expiresAt: response.expiresAt,
    }
  }

  /** 使用标准表单兑换 code，不发送 state、私有 flow 或 client_secret。 */
  async exchangeCode(input: OAuthCodeInput): Promise<NativeOAuthToken> {
    return readToken(
      await this.form("/oauth2/token", {
        grant_type: "authorization_code",
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        code: input.code,
        code_verifier: input.codeVerifier,
      }),
    )
  }

  /** 使用标准表单轮换 refresh，不自动重试一次性凭据。 */
  async refreshToken(refreshToken: string): Promise<NativeOAuthToken> {
    return readToken(
      await this.form("/oauth2/token", {
        grant_type: "refresh_token",
        client_id: "pigclaude-desktop",
        refresh_token: refreshToken,
      }),
    )
  }

  /** 撤销 grant，与设备关系撤销分离。 */
  async revokeToken(token: string): Promise<void> {
    await this.form("/oauth2/revoke", { client_id: "pigclaude-desktop", token })
  }

  /** 从 Bearer 保护端点读取原始版本，拒绝数值或缺失版本。 */
  async readDesktopSession(accessToken: string): Promise<DesktopSessionView> {
    return readSession(await this.request("/v1/desktop/session", { method: "GET", accessToken }))
  }

  /** 捕获本次业务请求的主进程 Bearer，不访问网站 Cookie。 */
  protected async bearer(): Promise<string> {
    const token = await this.#accessToken?.()
    if (!token) throw new PigclaudeApiError("invalid_token", 401, "invalid_token")
    return token
  }

  /** 发送有界请求；完整 body deadline、无 Cookie、无重定向、无网络重试。 */
  protected async request(
    path: string,
    options: {
      method: "GET" | "POST"
      body?: string
      contentType?: string
      accessToken?: string
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" }
    if (options.contentType) headers["content-type"] = options.contentType
    if (options.accessToken) headers.authorization = `Bearer ${options.accessToken}`
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new PigclaudeApiError("SERVER_UNAVAILABLE", null))
      }, 10_000)
    })
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const response = await this.#fetcher(new URL(path, this.#baseUrl).toString(), {
            method: options.method,
            headers,
            body: options.body,
            signal: controller.signal,
            credentials: "omit",
            redirect: "error",
          })
          const raw = await response.text()
          let body: unknown
          try {
            body = raw ? (JSON.parse(raw) as unknown) : undefined
          } catch {
            body = undefined
          }
          if (!response.ok) {
            const oauthError = isRecord(body) ? safeRemoteCode(body.error) : undefined
            const appError = isRecord(body) ? body.app_error : undefined
            const code =
              appError === "ACCOUNT_BANNED" || appError === "DEVICE_REVOKED"
                ? appError
                : isRecord(body) && safeRemoteCode(body.code)
                  ? safeRemoteCode(body.code)!
                  : (oauthError ?? "HTTP_ERROR")
            throw new PigclaudeApiError(code, response.status, oauthError)
          }
          return body
        })(),
      ])
    } catch (error: unknown) {
      if (error instanceof PigclaudeApiError) throw error
      throw new PigclaudeApiError("SERVER_UNAVAILABLE", null)
    } finally {
      clearTimeout(timer)
    }
  }

  private form(path: string, body: Record<string, string>): Promise<unknown> {
    return this.request(path, {
      method: "POST",
      body: new URLSearchParams(body).toString(),
      contentType: "application/x-www-form-urlencoded",
    })
  }
}

/** 验证服务端四个 string 字段，不把版本转换成 JS Number。 */
export function readSession(value: unknown): DesktopSessionView {
  if (
    !isRecord(value) ||
    !nonempty(value.userId) ||
    typeof value.deviceId !== "string" ||
    !/^pcd_[0-9a-f]{64}$/.test(value.deviceId) ||
    !positiveVersion(value.bindingEpoch) ||
    !positiveVersion(value.authVersion)
  ) {
    throw invalidResponse()
  }
  return {
    userId: value.userId,
    deviceId: value.deviceId,
    bindingEpoch: value.bindingEpoch,
    authVersion: value.authVersion,
  }
}

function readToken(value: unknown): NativeOAuthToken {
  if (
    !isRecord(value) ||
    !nonempty(value.access_token) ||
    !nonempty(value.refresh_token) ||
    value.token_type !== "Bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isSafeInteger(value.expires_in) ||
    value.expires_in <= 0 ||
    value.expires_in > MAX_ACCESS_TOKEN_SECONDS ||
    typeof value.scope !== "string" ||
    !value.scope ||
    value.scope.split(" ").some((scope) => !NATIVE_SCOPES.some((allowed) => allowed === scope)) ||
    "id_token" in value ||
    "sessionCookie" in value
  )
    throw invalidResponse()
  return {
    access_token: value.access_token,
    token_type: "Bearer",
    expires_in: value.expires_in,
    refresh_token: value.refresh_token,
    scope: value.scope,
  }
}
function httpUrl(value: string): URL {
  const url = new URL(value)
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error("API origin 无效")
  }
  return url
}
function invalidResponse(): PigclaudeApiError {
  return new PigclaudeApiError("INVALID_RESPONSE", 200)
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}
function positiveVersion(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeRemoteCode(value: unknown): string | undefined {
  const known = [
    "invalid_request",
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_scope",
    "access_denied",
    "server_error",
    "temporarily_unavailable",
    "invalid_token",
    "insufficient_scope",
    "ACCOUNT_BANNED",
    "DEVICE_REVOKED",
    "MEMBERSHIP_EXPIRED",
    "MEMBERSHIP_REQUIRED",
    "SERVER_UNAVAILABLE",
    "AUTHORIZATION_NOT_FOUND",
    "AUTHORIZATION_EXPIRED",
    "AUTHORIZATION_INVALID_STATE",
    "AUTHORIZATION_ALREADY_APPROVED",
    "AUTHORIZATION_REPLACE_REQUIRED",
    "AUTHORIZATION_BINDING_STALE",
    "AUTHORIZATION_DEVICE_REVOKED",
    "AUTHORIZATION_UNAUTHORIZED",
    "AUTHORIZATION_INTERNAL",
  ]
  return typeof value === "string" && known.includes(value) ? value : undefined
}
