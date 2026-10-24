// 负责标准 OAuth/OIDC wire 契约；native 响应不接受 ID Token，网站令牌只由 Rust RP 持有。

/** access token 最长有效期（秒）；接近 grant 绝对到期时服务端会给出更短的值。 */
export const MAX_ACCESS_TOKEN_SECONDS = 3600

/** OAuth access token 的标准响应字段，有效期 1～3600 秒的整数。 */
export type OAuthTokenResponse = {
  access_token: string
  token_type: "Bearer"
  expires_in: number
  refresh_token?: string
  scope: string
}

/** 原生 OAuth 响应没有 ID Token 字段。 */
export type NativeOAuthTokenResponse = OAuthTokenResponse

/** OIDC 令牌只能由 Rust RP 消费；此类型描述协议而不授权浏览器持有。 */
export type OidcTokenResponse = OAuthTokenResponse & { id_token: string }

/** 协议端点使用标准错误，包括静默交互需要用户参与的响应。 */
export type OAuthErrorCode =
  | "invalid_request"
  | "unauthorized_client"
  | "invalid_client"
  | "invalid_scope"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "access_denied"
  | "login_required"
  | "interaction_required"
  | "temporarily_unavailable"
  | "server_error"

const appErrors = [
  "ACCOUNT_LINK_REQUIRED",
  "IDENTITY_ALREADY_LINKED",
  "VERIFIED_EMAIL_REQUIRED",
  "RECENT_AUTH_REQUIRED",
  "LAST_CREDENTIAL",
  "PROVIDER_UNAVAILABLE",
  "DEVICE_ID_UNAVAILABLE",
  "ACCOUNT_BANNED",
  "DEVICE_REVOKED",
  "ACCOUNT_VERSION_CONFLICT",
  "DEVICE_BINDING_CONFLICT",
] as const

/** 固定业务错误补充协议错误，不改变 OAuth error 的语义。 */
export type OAuthAppError = (typeof appErrors)[number]

/** 标准 OAuth 错误响应，业务说明仅使用固定 app_error。 */
export type OAuthErrorResponse = {
  error: OAuthErrorCode
  error_description?: string
  app_error?: OAuthAppError
}

const protocolErrors: readonly string[] = [
  "invalid_request",
  "unauthorized_client",
  "invalid_client",
  "invalid_scope",
  "invalid_grant",
  "unsupported_grant_type",
  "unsupported_response_type",
  "access_denied",
  "login_required",
  "interaction_required",
  "temporarily_unavailable",
  "server_error",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 拒绝驼峰字段、非标准有效期及把 OIDC token 交给 native 的响应。 */
export function isNativeOAuthTokenResponse(value: unknown): value is NativeOAuthTokenResponse {
  return (
    isRecord(value) &&
    typeof value.access_token === "string" &&
    value.access_token.length > 0 &&
    value.token_type === "Bearer" &&
    typeof value.expires_in === "number" &&
    Number.isSafeInteger(value.expires_in) &&
    value.expires_in > 0 &&
    value.expires_in <= MAX_ACCESS_TOKEN_SECONDS &&
    typeof value.scope === "string" &&
    (value.refresh_token === undefined ||
      (typeof value.refresh_token === "string" && value.refresh_token.length > 0)) &&
    !("id_token" in value)
  )
}

/** 校验协议错误及可选固定业务错误，拒绝旧式 code/message 包装。 */
export function isOAuthErrorResponse(value: unknown): value is OAuthErrorResponse {
  return (
    isRecord(value) &&
    typeof value.error === "string" &&
    protocolErrors.includes(value.error) &&
    (value.error_description === undefined || typeof value.error_description === "string") &&
    (value.app_error === undefined ||
      (typeof value.app_error === "string" && appErrors.some((code) => code === value.app_error)))
  )
}
