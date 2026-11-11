// 负责将服务端本人恢复事实投影为不可授予业务权限的脱敏视图。
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { DesktopRecoverySnapshot } from "@pigclaude/contracts/desktop-membership"

/** 恢复视图。保证 recovery 字段始终存在。 */
export type RecoveryMembershipView = MembershipView & Required<Pick<MembershipView, "recovery">>

/** active 恢复事实也先保持受限，只有独立业务核验才能发布 active。 */
export function recoveryView(facts: DesktopRecoverySnapshot): RecoveryMembershipView {
  return {
    startupPhase: "settled",
    revision: 0,
    state: facts.membership.status === "expired" ? "expired" : "verification_required",
    account: { ...facts.account },
    tier: facts.membership.tier,
    membershipValidUntil: facts.membership.validUntil,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: facts.bindingEpoch,
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
    recovery: {
      status: facts.membership.status,
      grantExpiresAt: facts.grantExpiresAt,
      canRevoke: facts.canRevoke,
    },
  }
}
