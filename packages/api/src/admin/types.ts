// 负责定义管理员 API 的请求、响应和 decimal string 分页类型。
import type { UserAccountView } from "@pigclaude/contracts/account-status"

/** 管理员登录请求。 */
export interface AdminLoginRequest {
  account: string
  password: string
  captchaToken?: string
}
/** 管理员登录响应。 */
export interface AdminLoginResponse {
  account: string
}
/** 当前管理员摘要。 */
export interface AdminMeResponse {
  id: string
  account: string
  status: string
  permissions: string[]
}

/** 管理员用户列表项，字段保持服务端脱敏摘要语义。 */
export interface AdminUserItem extends UserAccountView {
  id: string
  nickname: string
  email: string
  avatar: string
  githubLogin: string
  balance: string
  createdAt: string
  lastLoginAt: string | null
}

/** 管理员用户列表查询，游标始终按 decimal string 传输。 */
export interface ListUsersQuery {
  status?: "active" | "banned" | ""
  cursor?: string
  limit?: number
  [key: string]: string | number | undefined
}

/** 管理员用户分页响应。 */
export interface ListUsersResponse {
  items: AdminUserItem[]
  nextCursor: string
}
/** 不可变安全审计记录。 */
export interface MembershipAuditItem {
  id: string
  eventType: string
  userId: string | null
  deviceId: string
  bindingEpoch: string
  result: string
  reason: string
  operatorType: string
  operatorId: string
  clientIp: string
  userAgent: string
  createdAt: string | null
}
/** 审计列表查询。 */
export interface ListMembershipAuditsQuery {
  userId?: string
  eventType?: string
  cursor?: string
  limit?: number
  [key: string]: string | number | undefined
}
/** 审计分页响应。 */
export interface ListMembershipAuditsResponse {
  items: MembershipAuditItem[]
  nextCursor: string
}
