// 负责 renderer 对会员状态快照的纯判断：启动占位、新旧取舍和登录页门禁提示。
import type { MembershipView } from "@pigclaude/contracts/membership"

/** 启动时的占位快照。保证首屏停在「正在连接」而不是误判为已登录。 */
export function initialMembershipView(): MembershipView {
  return {
    startupPhase: "checking",
    revision: 0,
    state: "connecting",
    account: null,
    productCode: null,
    planKind: null,
    lifetime: false,
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
    connecting: "正在连接 Rust 授权服务…",
    configuration_error: "桌面授权配置无效，请检查本地服务地址。",
    signed_out: "请先在浏览器中登录并授权这台设备。",
    verification_required: "当前账户没有可用会员授权，请完成浏览器授权后重试。",
    expired: "会员已到期，请续期后重新检查。",
    device_revoked: "这台设备已被撤销，请重新授权当前设备。",
    error: "暂时无法验证会员状态，请检查 Rust 服务是否运行。",
  }
  return messages[view.state]
}
