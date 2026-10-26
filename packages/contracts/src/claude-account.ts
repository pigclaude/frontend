// 负责定义桌面端可见的脱敏 Claude 账号、代理和登录事件契约，不携带任何凭据。

/** renderer 可见的账号指纹。字段与 local-store 的 FingerprintConfig 保持一致。 */
export type ClaudeFingerprintView = {
  seed: string
  brand: string
  platform: string
  lang: string
  timezone: string
  canvasNoise: boolean
  clientRectsNoise: boolean
}

/** renderer 可见的 Claude 账号视图。保证不含 access/refresh token、PKCE 材料或代理密码。 */
export type ClaudeAccountView = {
  id: string
  displayName: string
  enabled: boolean
  email: string | null
  subscriptionType: string | null
  needsReauth: boolean
  credentialExpiresAt: number | null
  /** 额度冷却结束时间；null 表示未冷却，缺省表示旧版主进程没有提供。 */
  exhaustedUntil?: string | null
  proxyId: string
  fingerprint: ClaudeFingerprintView
  createdAt: string
  updatedAt: string
}

/** 账号可用性输入；主进程选号器和 renderer 账号菜单共用同一个判断。 */
export type AccountAvailability = {
  enabled: boolean
  needsReauth: boolean
  hasCredential: boolean
  exhaustedUntil: string | null | undefined
  proxyUrl: string | null | undefined
}

// 保证账号启用、无需重新授权、有凭据、未在额度冷却中，并且绑定了非空代理。
// 选号器和界面都调用这个谓词，避免界面显示可用但启动时报 NO_AVAILABLE_ACCOUNT。
export function isAccountSelectable(input: AccountAvailability, nowMs: number): boolean {
  if (!input.enabled || input.needsReauth || !input.hasCredential) return false
  if (input.proxyUrl === null || input.proxyUrl === undefined || input.proxyUrl === "") return false
  if (input.exhaustedUntil === null || input.exhaustedUntil === undefined) return true
  const until = Date.parse(input.exhaustedUntil)
  return !Number.isFinite(until) || until <= nowMs
}

/** 代理最近一次测试的脱敏结果。 */
export type ProxyTestView = {
  ok: boolean
  ip: string | null
  latencyMs: number
  testedAt: string
}

/** renderer 可见的代理视图。url 中的密码已替换为 ***。 */
export type ProxyView = {
  id: string
  name: string
  url: string
  lastTest: ProxyTestView | null
}

/** Claude 账号登录流程阶段。 */
export type ClaudeAccountPhase =
  | "preparing"
  | "checking-egress"
  | "waiting-browser"
  | "exchanging"
  | "saving"
  | "authorized"
  | "blocked"
  | "failed"
  | "cancelled"

/** Claude 账号登录的稳定错误码。 */
export type ClaudeAccountErrorCode =
  | "PROXY_INVALID"
  | "INVALID_INPUT"
  | "FINGERPRINT_INVALID"
  | "ACCOUNT_NOT_FOUND"
  | "UNEXPECTED_ERROR"
  | "UNSUPPORTED_PROXY_SCHEME"
  | "PROXY_UNAVAILABLE"
  | "EGRESS_MISMATCH"
  | "EGRESS_CHECK_FAILED"
  | "BROWSER_MISSING"
  | "BROWSER_START_FAILED"
  | "BROWSER_STOP_FAILED"
  | "BROWSER_PROFILE_DELETE_FAILED"
  | "AUTHORIZATION_TIMEOUT"
  | "AUTHORIZATION_CANCELLED"
  | "OAUTH_STATE_MISMATCH"
  | "OAUTH_DENIED"
  | "OAUTH_EXCHANGE_FAILED"
  | "ACCOUNT_MISMATCH"
  | "STORAGE_FAILED"
  | "CREDENTIAL_REFRESH_FAILED"
  | "MEMBERSHIP_REQUIRED"

/** 出口核对结果。字段与 login-gate 的 EgressResult 保持一致。 */
export type EgressView =
  | { ok: true; ip: string }
  | { ok: false; reason: "proxy" | "timeout" | "parse" | "mismatch"; message: string }

/** 登录流程推给 renderer 的事件，只含阶段、账号 ID 和脱敏错误。 */
export type ClaudeAccountEvent = {
  accountId: string
  phase: ClaudeAccountPhase
  errorCode: ClaudeAccountErrorCode | null
  message: string | null
}

/** 保证账号视图字段完整，并且不夹带凭据字段。 */
export function isClaudeAccountView(value: unknown): value is ClaudeAccountView {
  if (!isRecord(value)) return false
  if (containsSecretField(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.enabled === "boolean" &&
    (value.email === null || typeof value.email === "string") &&
    (value.subscriptionType === null || typeof value.subscriptionType === "string") &&
    typeof value.needsReauth === "boolean" &&
    (value.credentialExpiresAt === null ||
      (typeof value.credentialExpiresAt === "number" &&
        Number.isFinite(value.credentialExpiresAt))) &&
    (value.exhaustedUntil === undefined ||
      value.exhaustedUntil === null ||
      typeof value.exhaustedUntil === "string") &&
    typeof value.proxyId === "string" &&
    isClaudeFingerprintView(value.fingerprint) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  )
}

/** 保证代理视图字段完整，并且不夹带密码字段。 */
export function isProxyView(value: unknown): value is ProxyView {
  if (!isRecord(value)) return false
  if (containsSecretField(value) || "password" in value) return false
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    (value.lastTest === null || isProxyTestView(value.lastTest))
  )
}

/** 保证登录事件字段完整，阶段和错误码在固定枚举内。 */
export function isClaudeAccountEvent(value: unknown): value is ClaudeAccountEvent {
  if (!isRecord(value)) return false
  return (
    typeof value.accountId === "string" &&
    isAccountPhase(value.phase) &&
    (value.errorCode === null || isAccountErrorCode(value.errorCode)) &&
    (value.message === null || typeof value.message === "string")
  )
}

/** 保证指纹字段类型完整；种子范围和枚举值由账号服务在写入前校验。 */
export function isClaudeFingerprintView(value: unknown): value is ClaudeFingerprintView {
  if (!isRecord(value)) return false
  return (
    typeof value.seed === "string" &&
    typeof value.brand === "string" &&
    typeof value.platform === "string" &&
    typeof value.lang === "string" &&
    typeof value.timezone === "string" &&
    typeof value.canvasNoise === "boolean" &&
    typeof value.clientRectsNoise === "boolean"
  )
}

function isProxyTestView(value: unknown): value is ProxyTestView {
  if (!isRecord(value)) return false
  return (
    typeof value.ok === "boolean" &&
    (value.ip === null || typeof value.ip === "string") &&
    typeof value.latencyMs === "number" &&
    Number.isFinite(value.latencyMs) &&
    typeof value.testedAt === "string"
  )
}

function isAccountPhase(value: unknown): value is ClaudeAccountPhase {
  return (
    value === "preparing" ||
    value === "checking-egress" ||
    value === "waiting-browser" ||
    value === "exchanging" ||
    value === "saving" ||
    value === "authorized" ||
    value === "blocked" ||
    value === "failed" ||
    value === "cancelled"
  )
}

const accountErrorCodes = new Set<ClaudeAccountErrorCode>([
  "PROXY_INVALID",
  "INVALID_INPUT",
  "FINGERPRINT_INVALID",
  "ACCOUNT_NOT_FOUND",
  "UNEXPECTED_ERROR",
  "UNSUPPORTED_PROXY_SCHEME",
  "PROXY_UNAVAILABLE",
  "EGRESS_MISMATCH",
  "EGRESS_CHECK_FAILED",
  "BROWSER_MISSING",
  "BROWSER_START_FAILED",
  "BROWSER_STOP_FAILED",
  "BROWSER_PROFILE_DELETE_FAILED",
  "AUTHORIZATION_TIMEOUT",
  "AUTHORIZATION_CANCELLED",
  "OAUTH_STATE_MISMATCH",
  "OAUTH_DENIED",
  "OAUTH_EXCHANGE_FAILED",
  "ACCOUNT_MISMATCH",
  "STORAGE_FAILED",
  "CREDENTIAL_REFRESH_FAILED",
  "MEMBERSHIP_REQUIRED",
])

function isAccountErrorCode(value: unknown): value is ClaudeAccountErrorCode {
  return typeof value === "string" && accountErrorCodes.has(value as ClaudeAccountErrorCode)
}

function containsSecretField(value: Record<string, unknown>): boolean {
  return (
    "accessToken" in value ||
    "refreshToken" in value ||
    "codeVerifier" in value ||
    "clientSecret" in value
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
