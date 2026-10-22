// 负责定义当前Home用户资料与会员查询契约。
/** Rust AuthUserView 返回的当前用户身份摘要。 */
export interface AuthUserView {
  id: string
  nickname: string
  avatar: string
  email: string
  balance: string
  createdAt: string
}

/** user/me 端点只返回用户摘要。 */
export type MeResponse = AuthUserView
/** 独立权益响应与会员模块保持同一 DTO。 */
export type { EntitlementResponse } from "../membership/types"
