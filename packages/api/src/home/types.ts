// 负责定义第一阶段 home 登录、会员和设备授权 API 的类型契约。
import type { DeviceAuthorizationStatus } from "@pigclaude/contracts/device-authorization"

/** 注册请求。 */
export interface RegisterRequest {
  email: string
  password: string
  nickname: string
  captchaToken?: string
}
/** 登录请求。 */
export interface LoginRequest {
  email: string
  password: string
  captchaToken?: string
}
/** Rust AuthUserView 返回的当前用户身份摘要。 */
export interface AuthUserView {
  id: string
  nickname: string
  avatar: string
  email: string
  balance: string
  createdAt: string
  productCode: string
  planKind: string
  membershipStatus: string
  validUntil: string | null
}

/** user/me 端点返回的当前用户身份摘要，保持与 AuthUserView 同一 DTO。 */
export type MeResponse = AuthUserView
/** 会员套餐周期。 */
export type PlanKind = "day" | "week" | "lifetime"
/** 可购买会员套餐。 */
export interface PlanItem {
  id: string
  name: string
  productCode: string
  planKind: PlanKind
  priceFen: string
  originalPriceFen: string
  durationDays: string
  lifetime: boolean
  description: string
  termsVersion: string
  termsText: string
}
/** 套餐列表响应。 */
export interface ListPlansResponse {
  items: PlanItem[]
}
/** 当前会员权益响应。 */
export interface EntitlementResponse {
  productCode: string
  planKind: PlanKind
  status: "inactive" | "active" | "expired" | "revoked"
  lifetime: boolean
  validUntil: string | null
  termsVersion: string
  termsAcceptedAt: string | null
  entitlementVersion: string
}
/** 浏览器设备授权 flow 响应。 */
export interface AuthorizationResponse {
  flowId: string
  deviceId: string
  deviceFingerprintHash: string
  status: DeviceAuthorizationStatus
  existingDeviceId: string | null
  existingBindingEpoch: string | null
  requiresReplace: boolean
  expiresAt: string | null
}
/** 浏览器确认设备授权请求。 */
export interface ApproveAuthorizationRequest {
  replaceExisting: boolean
  state: string
}
/** 浏览器确认设备授权响应。 */
export interface ApproveAuthorizationResponse {
  deviceId: string
  bindingEpoch: string
  location?: string
}
