// 负责定义本机 Claude 订阅凭据及其运行时校验。

/** 一个 Claude 官方订阅账号的 OAuth 凭据。保证只在本机账号文件和主进程中使用。 */
export type ClaudeCredential = {
  schemaVersion: 1
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
  accountUuid: string | null
  email: string | null
  organizationUuid: string | null
  subscriptionType: string | null
  rateLimitTier: string | null
}

/** 保证只有完整 schemaVersion=1 的记录会被当作可用凭据，旧字符串凭据不通过。 */
export function isClaudeCredential(value: unknown): value is ClaudeCredential {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.accessToken) &&
    isNonEmptyString(value.refreshToken) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    Array.isArray(value.scopes) &&
    value.scopes.every((scope) => typeof scope === "string") &&
    isNullableString(value.accountUuid) &&
    isNullableString(value.email) &&
    isNullableString(value.organizationUuid) &&
    isNullableString(value.subscriptionType) &&
    isNullableString(value.rateLimitTier)
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
