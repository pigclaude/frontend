// 负责把 Claude CLI 凭据、~/.claude.json 元数据和 profile 合并成可保存的账号字段。

import { defaultClaudeFingerprint } from "@pigclaude/contracts/claude-account"
import type { AccountRecord, ClaudeCredential } from "@pigclaude/local-store"
import type { ClaudeCliAccountMetadata } from "./cli-account-metadata"
import type { ClaudeCliCredential } from "./cli-credential-reader"
import { ClaudeAccountError } from "./errors"
import type { ClaudeOAuthProfile } from "./subscription-oauth"

/** 导入相关的固定中文错误消息。保证不包含 token、Keychain 输出或命令参数。 */
export const claudeCliImportMessages = {
  confirmCopy: "请先确认复制 Claude CLI 凭据",
  expired: "Claude CLI 凭据已过期，请先在 Claude CLI 中刷新",
  mismatch: "已有账号绑定了另一个 Claude 账号",
} as const

/** 从 CLI 凭据、元数据和 profile 合并出的账号身份。 */
export type ClaudeCliImportIdentity = {
  accountUuid: string | null
  email: string | null
  organizationUuid: string | null
  subscriptionType: string | null
  rateLimitTier: string | null
}

/** 合并账号身份。保证 profile 优先，缺失字段回退 oauthAccount；rateLimitTier 顺序为 profile > metadata > CLI。 */
export function mergeClaudeCliIdentity(
  cli: ClaudeCliCredential,
  metadata: ClaudeCliAccountMetadata | null,
  profile: ClaudeOAuthProfile | null,
): ClaudeCliImportIdentity {
  return {
    accountUuid: profile?.accountUuid ?? metadata?.accountUuid ?? null,
    email: profile?.email ?? metadata?.emailAddress ?? null,
    organizationUuid: profile?.organizationUuid ?? metadata?.organizationUuid ?? null,
    subscriptionType: profile?.subscriptionType ?? cli.subscriptionType,
    rateLimitTier:
      profile?.rateLimitTier ?? metadata?.organizationRateLimitTier ?? cli.rateLimitTier ?? null,
  }
}

/** 按 accountUuid 或 email 查找已有账号。保证 accountUuid 优先，email 比较忽略大小写和首尾空白。 */
export function findClaudeCliAccount(
  accounts: readonly AccountRecord[],
  identity: ClaudeCliImportIdentity,
): AccountRecord | null {
  if (identity.accountUuid !== null) {
    const byUuid = accounts.find(
      (account) => account.credential?.accountUuid === identity.accountUuid,
    )
    if (byUuid !== undefined) return byUuid
  }
  if (identity.email === null) return null
  const email = identity.email.trim().toLowerCase()
  if (email === "") return null
  return (
    accounts.find((account) => account.credential?.email?.trim().toLowerCase() === email) ?? null
  )
}

/** 校验已有账号没有绑定另一个 Claude 账号。保证冲突时抛固定错误，不覆盖原凭据。 */
export function assertClaudeCliIdentity(
  existing: AccountRecord | null,
  identity: ClaudeCliImportIdentity,
): void {
  if (existing === null) return
  const previous = existing.credential?.accountUuid ?? null
  if (previous !== null && identity.accountUuid !== null && previous !== identity.accountUuid) {
    throw new ClaudeAccountError("ACCOUNT_MISMATCH", claudeCliImportMessages.mismatch)
  }
}

/** 构造导入后的凭据。保证 token 全部来自 CLI，已有凭据只用来补空身份字段。 */
export function buildClaudeCliCredential(
  cli: ClaudeCliCredential,
  identity: ClaudeCliImportIdentity,
  existing: ClaudeCredential | null,
): ClaudeCredential {
  return {
    schemaVersion: 1,
    accessToken: cli.accessToken,
    refreshToken: cli.refreshToken,
    expiresAt: cli.expiresAt,
    scopes: [...cli.scopes],
    accountUuid: identity.accountUuid ?? existing?.accountUuid ?? null,
    email: identity.email ?? existing?.email ?? null,
    organizationUuid: identity.organizationUuid ?? existing?.organizationUuid ?? null,
    subscriptionType: identity.subscriptionType ?? existing?.subscriptionType ?? null,
    rateLimitTier: identity.rateLimitTier ?? existing?.rateLimitTier ?? null,
  }
}

/** 计算导入账号的显示名。保证输入 > fullName > displayName > 邮箱本地部分 > 固定兜底。 */
export function claudeCliDisplayName(
  inputName: string,
  metadata: ClaudeCliAccountMetadata | null,
  email: string | null,
): string {
  const requested = inputName.trim()
  if (requested !== "") return requested
  const fullName = metadata?.fullName?.trim() ?? ""
  if (fullName !== "") return fullName
  const displayName = metadata?.displayName?.trim() ?? ""
  if (displayName !== "") return displayName
  const localPart = email?.split("@")[0]?.trim() ?? ""
  return localPart !== "" ? localPart : "Claude CLI 账号"
}

/** 构造导入后的账号记录。保证命中已有账号时保留 id、指纹、代理、启用状态、冷却时间和创建时间。 */
export function buildClaudeCliAccountRecord(input: {
  existing: AccountRecord | null
  newId: string
  displayName: string
  credential: ClaudeCredential
  browserProfileDir: string
  now: string
}): AccountRecord {
  if (input.existing !== null) {
    return {
      ...input.existing,
      displayName: input.displayName,
      credential: input.credential,
      needsReauth: false,
      updatedAt: input.now,
    }
  }
  return {
    schemaVersion: 3,
    id: input.newId,
    displayName: input.displayName,
    enabled: true,
    credential: input.credential,
    needsReauth: false,
    proxyId: null,
    fingerprint: defaultClaudeFingerprint(),
    browserProfileDir: input.browserProfileDir,
    exhaustedUntil: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}
