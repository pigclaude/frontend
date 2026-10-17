// 负责定义桌面端可见的脱敏会员状态契约，不携带服务端凭据或本机秘密。

/** 会员状态机对 renderer 暴露的稳定状态名称。 */
export type MembershipState =
  | "configuration_error"
  | "signed_out"
  | "connecting"
  | "active"
  | "offline_grace"
  | "expired"
  | "verification_required"
  | "device_revoked"
  | "error"

/** renderer 使用的会员状态快照，金额和版本字段保持服务端 decimal string 语义。 */
export interface MembershipView {
  startupPhase: "checking" | "settled"
  revision: number
  state: MembershipState
  account: { userId: string; nickname: string; email: string; avatar: string } | null
  productCode: "pigclaude" | null
  planKind: "day" | "week" | "lifetime" | null
  lifetime: boolean
  membershipValidUntil: string | null
  offlineValidUntil: string | null
  lastVerifiedAt: string | null
  nextVerificationAt: string | null
  bindingEpoch: string | null
  errorCode: string | null
  serverReason: string | null
  authorizationUrl: string | null
}
