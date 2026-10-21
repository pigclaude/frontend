// 测试「已看过引导」标记：按账号区分、写入固定值，存储出错时不打扰用户也不抛错。
import { describe, expect, it } from "vitest"
import {
  hasSeenOnboarding,
  markOnboardingSeen,
  onboardingSeenKey,
  type OnboardingStorage,
} from "./onboarding-storage"

function fakeStorage(): OnboardingStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  }
}

function brokenStorage(): OnboardingStorage {
  return {
    getItem: () => {
      throw new Error("storage disabled")
    },
    setItem: () => {
      throw new Error("quota exceeded")
    },
  }
}

describe("onboarding seen flag", () => {
  it("keeps the seen flag per account", () => {
    const storage = fakeStorage()
    markOnboardingSeen("u1", storage)
    expect(hasSeenOnboarding("u1", storage)).toBe(true)
    expect(hasSeenOnboarding("u2", storage)).toBe(false)
  })

  it("stores 1 under pigclaude:onboarding-seen:<userId>", () => {
    const storage = fakeStorage()
    markOnboardingSeen("u1", storage)
    expect(onboardingSeenKey("u1")).toBe("pigclaude:onboarding-seen:u1")
    expect(storage.data.get("pigclaude:onboarding-seen:u1")).toBe("1")
  })

  it("ignores values other than 1", () => {
    const storage = fakeStorage()
    storage.setItem(onboardingSeenKey("u1"), "0")
    expect(hasSeenOnboarding("u1", storage)).toBe(false)
  })

  it("treats storage failures as seen", () => {
    expect(hasSeenOnboarding("u1", brokenStorage())).toBe(true)
  })

  it("fails silently when the flag cannot be written", () => {
    expect(() => markOnboardingSeen("u1", brokenStorage())).not.toThrow()
  })

  it("treats a missing localStorage as seen", () => {
    expect(hasSeenOnboarding("u1")).toBe(true)
    expect(() => markOnboardingSeen("u1")).not.toThrow()
  })
})
