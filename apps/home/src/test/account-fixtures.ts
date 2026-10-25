// 负责个人中心页面测试共用的当前用户和会员数据。
import type { MeResponse } from "@pigclaude/api/home/types"
import type { EntitlementResponse } from "@pigclaude/api/membership/types"

/** 用本地时间构造的 ISO 时间，避免断言依赖运行机器的时区。 */
export const localIso = (year: number, month: number, day: number, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).toISOString()

/** 有密码、邮箱已验证的普通用户。 */
export function accountUser(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: "100001",
    nickname: "林小猪",
    avatar: "",
    email: "lin@example.com",
    createdAt: localIso(2026, 10, 3),
    emailVerified: true,
    hasPassword: true,
    passwordChangedAt: localIso(2026, 10, 12),
    ...overrides,
  }
}

/** VIP 会员，2027/10/19 到期。 */
export function activeEntitlement(): EntitlementResponse {
  return {
    status: "active",
    tier: { code: "vip", name: "VIP", level: 1, cardStyle: "azure" },
    validUntil: localIso(2027, 10, 19),
    remainingSeconds: "31536000",
    entitlementVersion: "3",
  }
}

/** 从未开通过会员。 */
export function noEntitlement(): EntitlementResponse {
  return {
    status: "none",
    tier: null,
    validUntil: null,
    remainingSeconds: "0",
    entitlementVersion: "0",
  }
}
