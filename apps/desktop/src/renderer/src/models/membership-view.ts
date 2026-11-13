// 负责 renderer 对会员状态快照的纯判断：启动占位、新旧取舍和登录页门禁提示。
import { desktopText } from "../locale/text"
import type { MembershipView } from "@pigclaude/contracts/membership"

/** 启动时的占位快照。保证首屏停在「正在连接」而不是误判为已登录。 */
export function initialMembershipView(): MembershipView {
  return {
    startupPhase: "checking",
    revision: 0,
    state: "connecting",
    account: null,
    tier: null,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: null,
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
  }
}

/** 只接受版本不低于当前的快照。保证迟到的旧结果不会覆盖新状态。 */
export function newerMembershipView(
  current: MembershipView,
  incoming: MembershipView,
): MembershipView {
  return incoming.revision >= current.revision ? incoming : current
}

/** 会员不可用时登录页显示的门禁提示。会员有效时返回 undefined。 */
export function membershipGateMessage(view: MembershipView): string | undefined {
  const messages: Partial<Record<MembershipView["state"], string>> = {
    connecting: desktopText("flows.membership-view.1"),
    configuration_error: desktopText("flows.membership-view.2"),
    signed_out: desktopText("flows.membership-view.3"),
    verification_required: desktopText("flows.membership-view.4"),
    expired: desktopText("flows.membership-view.5"),
    device_revoked: desktopText("flows.membership-view.6"),
    error: desktopText("flows.membership-view.7"),
  }
  return messages[view.state]
}
