// 负责定义桌面端可见的脱敏会员状态契约，不携带服务端凭据或本机秘密。

/** 会员状态机对 renderer 暴露的稳定状态名称。 */
export type MembershipState =
  | "configuration_error"
  | "signed_out"
  | "connecting"
  | "active"
  | "network_grace"
  | "offline_grace"
  | "expired"
  | "verification_required"
  | "device_revoked"
  | "error"

/** 有效核验和短暂的网络故障都保留已启动的桌面资源；业务执行仍须实时校验。 */
export function keepsMembershipRuntime(state: MembershipState): boolean {
  return state === "active" || state === "network_grace"
}

/** 服务端嵌套会员等级摘要，不携带可变价格或套餐期限。 */
export interface TierView {
  code: string
  name: string
  level: number
}

/** 独立恢复读取的事实只解释原因，不能据此授予业务使用权限。 */
export interface MembershipRecovery {
  status: "none" | "active" | "expired" | "revoked"
  grantExpiresAt: string
  canRevoke: boolean
}

/** renderer 使用的会员状态快照，金额和版本字段保持服务端 decimal string 语义。 */
export interface MembershipView {
  /** 主进程当前账号与逻辑会话的动作关联，不作为服务端权限。 */
  actionContextId?: string
  recovery?: MembershipRecovery
  startupPhase: "checking" | "settled"
  revision: number
  state: MembershipState
  account: { userId: string; nickname: string; email: string; avatar: string } | null
  tier: TierView | null
  membershipValidUntil: string | null
  offlineValidUntil: string | null
  lastVerifiedAt: string | null
  nextVerificationAt: string | null
  bindingEpoch: string | null
  errorCode: string | null
  serverReason: string | null
  authorizationUrl: string | null
}
