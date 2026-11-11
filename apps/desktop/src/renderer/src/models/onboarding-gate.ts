// 负责决定会员确认有效后的第一个位置：没看过引导的账号进引导，其余进会话。
import type { MembershipView } from "@pigclaude/contracts/membership"
import { hasSeenOnboarding, type OnboardingStorage } from "../lib/onboarding-storage"
import type { NavLocation } from "./navigation"

/**
 * 登录后或启动时会员有效后打开哪个位置。保证只有会员 active、带有账号 userId、
 * 且这个账号在本机没有「已看过引导」标记时才返回引导流程，其余情况返回会话。
 */
export function initialLocationAfterLogin(
  view: MembershipView,
  storage?: OnboardingStorage,
): NavLocation {
  const userId = view.account?.userId
  const onboarding: NavLocation = { kind: "flow", flow: "onboarding" }
  if (view.state !== "active" || !userId) return { kind: "session" }
  return hasSeenOnboarding(userId, storage) ? { kind: "session" } : onboarding
}
