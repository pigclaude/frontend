// 负责严格验证当前 OAuth2 主进程安全仓库记录，拒绝旧协议和缺失原始版本。
import type { OAuthDesktopSession } from "@pigclaude/contracts/desktop-membership"
import { NATIVE_SCOPES, readSession } from "../api/oauth-client"

/** 只解析完整 schema1 OAuth2 记录，绝不从旧 Cookie/credential 推导身份。 */
export function parseOAuthDesktopSession(raw: string | null): OAuthDesktopSession | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (
      record.schemaVersion !== 1 ||
      record.protocol !== "oauth2" ||
      "sessionCookie" in record ||
      "credential" in record ||
      typeof record.accessToken !== "string" ||
      !record.accessToken ||
      typeof record.refreshToken !== "string" ||
      !record.refreshToken ||
      typeof record.grantedScope !== "string" ||
      !validScope(record.grantedScope) ||
      typeof record.scope !== "string" ||
      !validScope(record.scope) ||
      record.scope
        .split(" ")
        .some((scope) => !String(record.grantedScope).split(" ").includes(scope)) ||
      typeof record.accessTokenExpiresAt !== "number" ||
      !Number.isSafeInteger(record.accessTokenExpiresAt) ||
      record.accessTokenExpiresAt <= 0 ||
      typeof record.refreshTokenExpiresAt !== "number" ||
      !Number.isSafeInteger(record.refreshTokenExpiresAt) ||
      record.refreshTokenExpiresAt <= 0
    )
      return null
    return {
      schemaVersion: 1,
      protocol: "oauth2",
      ...readSession(record),
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      scope: record.scope,
      grantedScope: record.grantedScope,
      accessTokenExpiresAt: record.accessTokenExpiresAt,
      refreshTokenExpiresAt: record.refreshTokenExpiresAt,
    }
  } catch {
    return null
  }
}

function validScope(scope: string): boolean {
  const scopes = scope.split(" ")
  return (
    scopes.length > 0 &&
    new Set(scopes).size === scopes.length &&
    scopes.every((item) => NATIVE_SCOPES.some((allowed) => allowed === item))
  )
}
