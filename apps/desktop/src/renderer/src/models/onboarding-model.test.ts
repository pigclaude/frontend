// 测试引导步骤状态机：完成和跳过都前进一步，最后一步之后结束，任何一步都不锁定；从授权页回来时按结果续上进度。
import { describe, expect, it } from "vitest"
import {
  createOnboardingState,
  onboardingSteps,
  reduceOnboarding,
  resumeOnboarding,
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

describe("resumeOnboarding", () => {
  const leaving: OnboardingState = {
    step: "account",
    done: { proxy: true, account: false, session: false },
  }

  it("keeps the step and earlier progress when the authorization was cancelled", () => {
    expect(resumeOnboarding(leaving, false)).toEqual(leaving)
  })

  it("marks the account done and moves to the session step when authorized", () => {
    expect(resumeOnboarding(leaving, true)).toEqual({
      step: "session",
      done: { proxy: true, account: true, session: false },
    })
  })

  it("never finishes the onboarding by itself", () => {
    const last = createOnboardingState("session")
    expect(resumeOnboarding(last, true)).toEqual(last)
  })
})
