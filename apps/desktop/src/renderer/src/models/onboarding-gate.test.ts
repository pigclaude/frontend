// 测试登录后第一个位置的判断：会员有效、有账号且本机没看过引导才进引导，否则进会话。
import { describe, expect, it } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { markOnboardingSeen, type OnboardingStorage } from "../lib/onboarding-storage"
import { initialMembershipView } from "./membership-view"
import { initialLocationAfterLogin } from "./onboarding-gate"

const onboarding = { kind: "flow", flow: "onboarding" }
const session = { kind: "session" }

function fakeStorage(): OnboardingStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  }
}

function active(userId: string | null): MembershipView {
  return {
    ...initialMembershipView(),
    startupPhase: "settled",
    revision: 1,
    state: "active",
    account: userId ? { userId, nickname: "u", email: "u@example.com", avatar: "" } : null,
  }
}

describe("initialLocationAfterLogin", () => {
  it("opens onboarding for an active account that has not seen it", () => {
    expect(initialLocationAfterLogin(active("u1"), fakeStorage())).toEqual(onboarding)
  })

  it("opens chat once the account has seen onboarding", () => {
    const storage = fakeStorage()
    markOnboardingSeen("u1", storage)
    expect(initialLocationAfterLogin(active("u1"), storage)).toEqual(session)
    expect(initialLocationAfterLogin(active("u2"), storage)).toEqual(onboarding)
  })

  it("opens chat when there is no account to key the flag on", () => {
    expect(initialLocationAfterLogin(active(null), fakeStorage())).toEqual(session)
  })

  it("opens chat when membership is not active", () => {
    const view = { ...active("u1"), state: "offline_grace" as const }
    expect(initialLocationAfterLogin(view, fakeStorage())).toEqual(session)
  })
})
