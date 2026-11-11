// 负责定义浏览器授权会话、回调、token 和状态事件的共享类型。
import type { OAuthDesktopSession } from "@pigclaude/contracts/desktop-membership"

/** 浏览器授权的业务用途。保证 pigclaude 登录与 Claude 号池授权可区分。 */
export type AuthorizationPurpose = "pigclaude-login" | "claude-account"

/** pigclaude 授权入口。保证登录、注册和 Claude 账号授权使用同一协议。 */
export type AuthorizationMode = "login" | "register" | "authorize" | "switch"

/** 创建浏览器授权会话所需的业务参数。保证主进程知道授权目标与出口约束。 */
export type AuthorizationRequest = {
  purpose: AuthorizationPurpose
  mode: AuthorizationMode
  /** 仅关联同一次 UI 准备与取消，不作为身份、设备或授权材料。 */
  clientRequestId?: string | undefined
  accountName?: string | undefined
  proxyId?: string | undefined
  fingerprintSeed?: string | undefined
  bridgeExit?: string | undefined
  daemonExit?: string | undefined
}

/** 一次待完成的授权会话。保证 verifier 只留在主进程内。 */
export type AuthorizationSession = {
  sessionId: string
  state: string
  codeVerifier: string
  codeChallenge: string
  redirectUri: string
  expiresAt: number
  request: AuthorizationRequest
  consumed: boolean
}

/** 浏览器回调传回的授权码或失败信息。保证解析结果不直接携带秘密。 */
export type AuthorizationCallback = {
  code?: string | undefined
  state?: string | undefined
  error?: string | undefined
  errorDescription?: string | undefined
}

/** 授权服务交换出的秘密和脱敏身份信息。保证秘密只进入主进程的 vault。 */
export type AuthorizationToken = {
  accessToken?: string
  refreshToken?: string
  credential?: string | undefined
  accountId: string
  displayName: string
  expiresAt: number
  purpose: AuthorizationPurpose
  mode: AuthorizationMode
  /** Rust exchange 返回的脱敏设备信息。 */
  deviceId?: string
  bindingEpoch?: string
  userId?: string
  /** 第一方当前协议材料，只能进入主进程 session 仓库。 */
  oauthSession?: OAuthDesktopSession
  /** code HTTP 发起时捕获的本机逻辑归属，不能由 renderer 提交。 */
  oauthOwner?: number
}

/** 授权状态机的可见状态。保证 renderer 不需要知道 token 细节。 */
export type AuthorizationStatus =
  | "preparing"
  | "browser-open"
  | "awaiting-callback"
  | "exchanging"
  | "committing"
  | "completed"
  | "cancelled"
  | "denied"
  | "expired"
  | "state-mismatch"
  | "proxy-mismatch"
  | "network-error"
  | "exchange-error"

/** 主进程发给 renderer 的授权状态事件。保证事件只包含脱敏元数据。 */
export type AuthorizationStateEvent = {
  sessionId: string
  purpose: AuthorizationPurpose
  mode: AuthorizationMode
  status: AuthorizationStatus
  authorizationUrl?: string
  accountId?: string
  displayName?: string
  expiresAt?: number
  error?: string
}

/** 主进程启动授权的结果，保证 renderer 只得到会话地址而不是秘密。 */
export type AuthorizationStartResult =
  | { ok: true; sessionId: string; authorizationUrl: string; expiresAt: number }
  | { ok: false; status: "proxy-mismatch" | "network-error" | "cancelled"; error: string }
