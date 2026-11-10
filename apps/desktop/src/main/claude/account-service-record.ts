// 负责构造账号视图、凭据与重新授权时的身份校验。

import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { AccountRecord, ClaudeCredential } from "@pigclaude/local-store"
import { ClaudeAccountError } from "./errors"

/** 返回不含令牌的账号视图。 */
export function toView(account: AccountRecord): ClaudeAccountView {
  return {
    id: account.id,
    ...(account.browserProfileId ? { browserProfileId: account.browserProfileId } : {}),
    displayName: account.displayName,
    enabled: account.enabled,
    email: account.credential?.email ?? null,
    subscriptionType: account.credential?.subscriptionType ?? null,
    needsReauth: account.needsReauth,
    credentialExpiresAt: account.credential?.expiresAt ?? null,
    exhaustedUntil: account.exhaustedUntil,
    proxyId: account.proxyId,
    fingerprint: account.fingerprint,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

/** 组合新令牌和已知账号身份。 */
export function buildCredential(
  tokens: { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] },
  profile: {
    accountUuid: string | null
    email: string | null
    organizationUuid: string | null
    subscriptionType: string | null
    rateLimitTier: string | null
  } | null,
  existing: ClaudeCredential | null,
): ClaudeCredential {
  return {
    schemaVersion: 1,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    accountUuid: profile?.accountUuid ?? existing?.accountUuid ?? null,
    email: profile?.email ?? existing?.email ?? null,
    organizationUuid: profile?.organizationUuid ?? existing?.organizationUuid ?? null,
    subscriptionType: profile?.subscriptionType ?? existing?.subscriptionType ?? null,
    rateLimitTier: profile?.rateLimitTier ?? existing?.rateLimitTier ?? null,
  }
}

/** 不允许重新授权覆盖另一个已知账号的身份。 */
export function assertSameAccount(
  existing: AccountRecord | null,
  profile: {
    accountUuid: string | null
    email: string | null
  } | null,
): void {
  if (existing === null || profile === null) return
  const previous = existing.credential
  if (previous === null) return
  if (
    previous.accountUuid !== null &&
    profile.accountUuid !== null &&
    previous.accountUuid !== profile.accountUuid
  ) {
    throw new ClaudeAccountError("ACCOUNT_MISMATCH", "登录的是另一个 Claude 账号")
  }
  if (
    previous.accountUuid === null &&
    previous.email !== null &&
    profile.email !== null &&
    previous.email !== profile.email
  ) {
    throw new ClaudeAccountError("ACCOUNT_MISMATCH", "登录的是另一个 Claude 账号")
  }
}
