// 负责本机「已看过引导」标记的读写：按账号分键，只存一个 "1"，不存任何秘密。

/** 读写标记所需的最小存储能力；window.localStorage 满足它。 */
export type OnboardingStorage = Pick<Storage, "getItem" | "setItem">

/** 某个账号的标记键：pigclaude:onboarding-seen:<userId>。 */
export function onboardingSeenKey(userId: string): string {
  return `pigclaude:onboarding-seen:${userId}`
}

/** 这个账号在本机是否看过引导。存储不可用或读取出错时返回 true，宁可不显示也不反复打扰。 */
export function hasSeenOnboarding(userId: string, storage?: OnboardingStorage): boolean {
  try {
    const target = storage ?? globalThis.localStorage
    if (!target) return true
    return target.getItem(onboardingSeenKey(userId)) === "1"
  } catch {
    return true
  }
}

/** 记下这个账号已看过引导。存储不可用或写入出错时静默放弃。 */
export function markOnboardingSeen(userId: string, storage?: OnboardingStorage): void {
  try {
    const target = storage ?? globalThis.localStorage
    target?.setItem(onboardingSeenKey(userId), "1")
  } catch {
    // 写不进去时下次启动会再显示一次引导，不影响使用。
  }
}
