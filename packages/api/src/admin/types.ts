// 负责定义第一阶段管理员 API 的请求、响应和 decimal string 分页类型。

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
export interface AdminUserItem {
  id: string
  nickname: string
  email: string
  avatar: string
  githubLogin: string
  status: string
  balance: string
  createdAt: string
  lastLoginAt: string | null
}

/** 管理员用户列表查询，游标始终按 decimal string 传输。 */
export interface ListUsersQuery {
  cursor?: string
  limit?: number
  [key: string]: string | number | undefined
}

/** 管理员用户分页响应。 */
export interface ListUsersResponse {
  items: AdminUserItem[]
  nextCursor: string
}
/** 会员状态。 */
export type MembershipStatus = "active" | "expired" | "revoked"
/** 会员套餐周期。 */
export type MembershipPlanKind = "day" | "week" | "lifetime"
/** 会员列表项。 */
export interface MembershipItem {
  userId: string
  planId: string
  productCode: string
  planKind: MembershipPlanKind
  status: MembershipStatus
  lifetime: boolean
  validUntil: string | null
  termsVersion: string
  termsAcceptedAt: string | null
  entitlementVersion: string
}
/** 会员列表查询，cursor 和 userId 均按字符串传输。 */
export interface ListMembershipsQuery {
  userId?: string
  status?: MembershipStatus | ""
  cursor?: string
  limit?: number
  [key: string]: string | number | undefined
}
/** 会员分页响应。 */
export interface ListMembershipsResponse {
  items: MembershipItem[]
  nextCursor: string
}
/** 人工授予会员请求。 */
export interface GrantMembershipRequest {
  userId: string
  planId: string
  termsVersion: string
  remark: string
}
/** 撤销会员请求。 */
export interface RevokeMembershipRequest {
  userId: string
  reason: string
}
/** 已绑定设备摘要。 */
export interface MembershipDeviceItem {
  userId: string
  deviceId: string
  deviceEncryptionPublicKeyHash: string
  deviceSigningPublicKeyHash: string
  deviceFingerprintHash: string
  bindingEpoch: string
  lastSeenAt: string | null
}
/** 设备列表查询。 */
export interface ListMembershipDevicesQuery {
  userId?: string
  cursor?: string
  limit?: number
  [key: string]: string | number | undefined
}
/** 设备分页响应。 */
export interface ListMembershipDevicesResponse {
  items: MembershipDeviceItem[]
  nextCursor: string
}
/** 解绑设备请求。 */
export interface UnbindMembershipDeviceRequest {
  userId: string
  reason: string
}
/** 不可变安全审计记录。 */
export interface MembershipAuditItem {
  id: string
  eventType: string
  userId: string
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
