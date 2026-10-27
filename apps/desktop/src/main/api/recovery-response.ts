// 负责严格解析本人恢复快照，只保留界面所需事实，拒绝身份混淆和未知原因。
import type { DesktopRecoverySnapshot } from "@pigclaude/contracts/desktop-membership"
import { PigclaudeApiError, readSession } from "./oauth-client"

/** 解析独立恢复合同，不从错误码猜测会员状态或补造缺失资料。 */
export function readRecoveryResponse(value: unknown): DesktopRecoverySnapshot {
  const identity = readSession(value)
  if (!record(value) || !record(value.account) || !record(value.membership)) throw invalid()
  const account = value.account
  const membership = value.membership
  if (
    account.userId !== identity.userId ||
    typeof account.nickname !== "string" ||
    typeof account.email !== "string" ||
    typeof account.avatar !== "string" ||
    typeof membership.status !== "string" ||
    !["none", "active", "expired", "revoked"].includes(membership.status) ||
    (membership.entitlementVersion !== undefined &&
      (typeof membership.entitlementVersion !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(membership.entitlementVersion))) ||
    !timestamp(value.grantExpiresAt) ||
    typeof value.canRevoke !== "boolean" ||
    !(membership.validUntil === null || timestamp(membership.validUntil))
  )
    throw invalid()
  let tier: DesktopRecoverySnapshot["membership"]["tier"] = null
  if (membership.tier !== null) {
    const t = membership.tier
    if (
      !record(t) ||
      typeof t.code !== "string" ||
      typeof t.name !== "string" ||
      typeof t.level !== "number" ||
      !Number.isSafeInteger(t.level) ||
      t.level <= 0
    )
      throw invalid()
    tier = { code: t.code, name: t.name, level: t.level }
  }
  return {
    ...identity,
    account: {
      userId: identity.userId,
      nickname: account.nickname,
      email: account.email,
      avatar: account.avatar,
    },
    membership: {
      status: membership.status as DesktopRecoverySnapshot["membership"]["status"],
      tier,
      validUntil: membership.validUntil,
      ...(typeof membership.entitlementVersion === "string"
        ? { entitlementVersion: membership.entitlementVersion }
        : {}),
    },
    grantExpiresAt: value.grantExpiresAt,
    canRevoke: value.canRevoke,
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}
function invalid(): PigclaudeApiError {
  return new PigclaudeApiError("INVALID_RESPONSE", 200)
}
