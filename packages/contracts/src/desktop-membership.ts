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
