// 负责集中判断设备授权按钮是否可以执行，防止直链绕过业务状态 gate。
import type { DeviceAuthorizationStatus } from "@pigclaude/contracts/device-authorization"

/** 授权按钮使用的会员状态集合。 */
export type AuthorizationMembershipStatus = "inactive" | "active" | "expired" | "revoked"

/** 只有 pending flow、active entitlement 和已确认替换时才允许 approve。 */
export function canApproveAuthorization(input: {
  flowStatus: DeviceAuthorizationStatus
  membershipStatus: AuthorizationMembershipStatus
  requiresReplace: boolean
  replaceExisting: boolean
}): boolean {
  return (
    input.flowStatus === "pending" &&
    input.membershipStatus === "active" &&
    (!input.requiresReplace || input.replaceExisting)
  )
}
