// 负责定义 Electron 主进程与 Rust membership/device gate 之间的脱敏契约。
import type { MembershipView } from "./membership"

/** 从 desktop 合同入口重导出会员状态，保持 renderer 只依赖脱敏视图。 */
export type { MembershipState, MembershipView } from "./membership"

/** Rust 会员检查请求，保证本机设备代次只能作为服务端校验输入。 */
export type MembershipInspectRequest = {
  deviceId: string
  bindingEpoch: string | null
}

/** MembershipGate 对外暴露的唯一视图类型。 */
export type DesktopMembershipView = MembershipView

/** 软件使用前必须核验的业务能力；恢复信息本身不授予这些能力。 */
export const DESKTOP_BUSINESS_SCOPES = ["membership:read", "device:inspect"] as const

/** 服务端创建的短期办理目标，不包含账号、凭据或任意跳转地址。 */
export type CreatedMembershipRecoveryTarget = {
  targetId: string
  action: "open" | "renew" | "view"
  expiresAt: string
}

/** 主进程从本人只读恢复接口取得的脱敏事实，与现有 session 合同分开。 */
export type DesktopRecoverySnapshot = {
  userId: string
  deviceId: string
  bindingEpoch: string
  authVersion: string
  account: NonNullable<MembershipView["account"]>
  membership: {
    status: NonNullable<MembershipView["recovery"]>["status"]
    /** 权益版本用于区分新的恢复机会，不作为权限或支付授权。 */
    entitlementVersion?: string
    tier: MembershipView["tier"]
    validUntil: string | null
  }
  grantExpiresAt: string
  canRevoke: boolean
}

/** 主进程准备的短期撤销确认；只返回展示摘要及一次性关联标识。 */
export type DeviceWithdrawalConfirmation = {
  confirmationId: string
  account: { nickname: string; email: string }
  expiresAt: string
}

/** 当前 OAuth2 主进程秘密记录；没有旧 Cookie/vault 格式导入语义。 */
export type OAuthDesktopSession = {
  schemaVersion: 1
  protocol: "oauth2"
  userId: string
  deviceId: string
  bindingEpoch: string
  authVersion: string
  accessToken: string
  refreshToken: string
  scope: string
  /** 原始授权范围上限，刷新降权不会永久缩小此值。 */
  grantedScope: string
  accessTokenExpiresAt: number
  refreshTokenExpiresAt: number
}
