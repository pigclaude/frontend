// 负责决定会员确认有效后的第一屏：没看过引导的账号进引导，其余进主界面。
import type { MembershipView } from "@pigclaude/contracts/membership"
import { hasSeenOnboarding, type OnboardingStorage } from "../lib/onboarding-storage"
import type { Screen } from "../screens/screen"

/**
 * 登录后或启动时会员有效后打开哪一屏。保证只有会员 active、带有账号 userId、
 * 且这个账号在本机没有「已看过引导」标记时才返回 "onboarding"，其余情况返回 "chat"。
 */
export function initialScreenAfterLogin(view: MembershipView, storage?: OnboardingStorage): Screen {
  const userId = view.account?.userId
  if (view.state !== "active" || !userId) return "chat"
  return hasSeenOnboarding(userId, storage) ? "chat" : "onboarding"
}
