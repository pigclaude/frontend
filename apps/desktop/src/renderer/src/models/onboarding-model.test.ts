// 测试引导步骤状态机：完成和跳过都前进一步，最后一步之后结束，任何一步都不锁定。
import { describe, expect, it } from "vitest"
import {
  createOnboardingState,
  onboardingSteps,
  reduceOnboarding,
  type OnboardingState,
} from "./onboarding-model"

describe("reduceOnboarding", () => {
  it("starts at the proxy step with nothing done", () => {
    expect(createOnboardingState()).toEqual({
      step: "proxy",
      done: { proxy: false, account: false, session: false },
    })
  })

  it("can start at a later step", () => {
    expect(createOnboardingState("account").step).toBe("account")
  })

  it("advances on skip from every step", () => {
    let s = createOnboardingState()
    s = reduceOnboarding(s, { type: "skip" }) as OnboardingState
    expect(s.step).toBe("account")
    s = reduceOnboarding(s, { type: "skip" }) as OnboardingState
    expect(s.step).toBe("session")
    expect(reduceOnboarding(s, { type: "skip" })).toBe("finished")
  })

  it("marks the current step done on complete and advances", () => {
    const s = reduceOnboarding(createOnboardingState(), { type: "complete" }) as OnboardingState
    expect(s).toEqual({ step: "account", done: { proxy: true, account: false, session: false } })
  })

  it("leaves skipped steps not done", () => {
    let s = reduceOnboarding(createOnboardingState(), { type: "skip" }) as OnboardingState
    s = reduceOnboarding(s, { type: "complete" }) as OnboardingState
    expect(s.done).toEqual({ proxy: false, account: true, session: false })
  })

  it("finishes after completing the last step", () => {
    expect(reduceOnboarding(createOnboardingState("session"), { type: "complete" })).toBe(
      "finished",
    )
  })

  it("lists the three steps in order", () => {
    expect(onboardingSteps).toEqual(["proxy", "account", "session"])
  })
})
