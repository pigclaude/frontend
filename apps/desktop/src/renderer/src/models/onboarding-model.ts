// 负责新手引导的步骤状态：当前在哪一步、哪些步骤做完了；每一步都能跳过，没有锁定。

/** 引导的三步：添加代理、添加 Claude 账号、开始第一个会话。 */
export type OnboardingStep = "proxy" | "account" | "session"

/** 引导状态。done 只记录用主操作完成的步骤，跳过的步骤保持 false。 */
export type OnboardingState = { step: OnboardingStep; done: Record<OnboardingStep, boolean> }

/** 引导事件：complete 表示这一步的主操作做完了，skip 表示跳过。 */
export type OnboardingEvent = { type: "complete" | "skip" }

/** 三步的固定顺序。 */
export const onboardingSteps: readonly OnboardingStep[] = ["proxy", "account", "session"]

/** 新的引导状态，默认从第一步开始；从 Claude 授权页回来时可以直接停在指定步骤。 */
export function createOnboardingState(step: OnboardingStep = "proxy"): OnboardingState {
  return { step, done: { proxy: false, account: false, session: false } }
}

/** 推进一步。complete 和 skip 都前进到下一步；最后一步之后返回 "finished"。 */
export function reduceOnboarding(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState | "finished" {
  const done = event.type === "complete" ? { ...state.done, [state.step]: true } : state.done
  const next = onboardingSteps[onboardingSteps.indexOf(state.step) + 1]
  return next ? { step: next, done } : "finished"
}

/** 从 Claude 授权页回到引导：授权已完成时把当前步骤记为完成并前进一步，取消时原样停在离开时的步骤。 */
export function resumeOnboarding(state: OnboardingState, authorized: boolean): OnboardingState {
  if (!authorized) return state
  const next = reduceOnboarding(state, { type: "complete" })
  return next === "finished" ? state : next
}
