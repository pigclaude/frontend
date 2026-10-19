// 负责定义 Electron 主进程与 Rust membership/device gate 之间的脱敏契约。
import type { MembershipView } from "./membership"

/** 从 desktop 合同入口重导出会员状态，保持 renderer 只依赖脱敏视图。 */
export type { MembershipState, MembershipView } from "./membership"

/** Rust 会员检查请求，保证本机设备代次只能作为服务端校验输入。 */
export type MembershipInspectRequest = {
  deviceId: string
  bindingEpoch: string | null
}

/** Rust desktop start 请求，保证 verifier 只由主进程保留。 */
export type DesktopAuthorizationStartRequest = {
  mode?: "login" | "register" | "authorize"
  deviceId: string
  deviceFingerprintHash: string
  codeChallenge: string
  state: string
  clientId: string
  callbackUrl: string
  purpose: string
  redirectUri?: string
  deviceEncryptionPublicKeyHash?: string
  deviceSigningPublicKeyHash?: string
}

/** Rust desktop start 响应，保证地址由主进程解析并校验。 */
export type DesktopAuthorizationStartResponse = {
  flowId: string
  authorizationUrl: string
  expiresAt: string | number
  clientId?: string | null
  redirectUri?: string | null
  callbackUrl?: string | null
  purpose?: string | null
}

/** Rust desktop exchange 请求，保证 code 和 verifier 不进入 renderer。 */
export type DesktopAuthorizationExchangeRequest = {
  flowId: string
  code: string
  codeVerifier: string
  state: string
}

/** Rust desktop exchange 响应，只有设备和用户脱敏标识。 */
export type DesktopAuthorizationExchangeResponse = {
  deviceId: string
  bindingEpoch: string
  userId: string
  /** 服务端可选返回的 desktop session cookie 值，旧 server 仍可省略。 */
  sessionCookie?: string
}

/** Rust desktop revoke 请求，保证撤销只针对当前设备。 */
export type DesktopDeviceRevokeRequest = {
  deviceId: string
}

/** 主进程安全仓库中保存的最小恢复记录，字段不会传给 renderer。 */
export type MembershipSessionRecord = {
  accessToken?: string
  refreshToken?: string
  credential?: string
  accountId?: string
  deviceId: string
  bindingEpoch: string
  /** desktop inspect 使用的服务端 session cookie；旧 vault 记录没有此字段。 */
  sessionCookie?: string
}

/** MembershipGate 对外暴露的唯一视图类型。 */
export type DesktopMembershipView = MembershipView

/** API 失败时的稳定错误码，供 gate 决定显示和本机清理策略。 */
export type DesktopMembershipErrorCode =
  | "SERVER_UNAVAILABLE"
  | "AUTHORIZATION_NOT_FOUND"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_INVALID_STATE"
  | "AUTHORIZATION_ALREADY_APPROVED"
  | "AUTHORIZATION_REPLACE_REQUIRED"
  | "AUTHORIZATION_BINDING_STALE"
  | "AUTHORIZATION_DEVICE_REVOKED"
  | "AUTHORIZATION_UNAUTHORIZED"
  | "AUTHORIZATION_INTERNAL"
  | "SAFE_STORAGE_UNAVAILABLE"
  | "INVALID_RESPONSE"

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
