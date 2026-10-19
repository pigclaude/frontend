// 负责定义当前Home用户资料与会员查询契约。
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
