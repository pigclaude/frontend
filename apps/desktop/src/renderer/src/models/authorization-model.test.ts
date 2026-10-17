// 验证 Claude 账号授权的出口核对和外部等待流程。
import { describe, expect, it } from "vitest"
import { createAuthorizationState, reduceAuthorizationState } from "./authorization-model"

describe("authorization model", () => {
  it("出口不一致时不能生成授权链接", () => {
    let state = reduceAuthorizationState(createAuthorizationState(), {
      type: "set-exits",
      bridgeExit: "203.0.113.10",
      daemonExit: "198.51.100.20",
    })
    state = reduceAuthorizationState(state, { type: "check-exit" })
    expect(state).toMatchObject({ step: "exit", canLaunch: false, authorizationUrl: null })
  })

  it("出口为空时即使尝试启动也不能进入等待", () => {
    let state = reduceAuthorizationState(createAuthorizationState(), {
      type: "set-exits",
      bridgeExit: "",
      daemonExit: "",
    })
    state = reduceAuthorizationState(state, { type: "check-exit" })
    state = reduceAuthorizationState(state, {
      type: "start",
      url: "http://localhost:5173/authorize",
    })
    expect(state).toMatchObject({ step: "exit", canLaunch: false, authorizationUrl: null })
  })

  it("出口一致后进入外部等待，重置会清除批准状态", () => {
    let state = reduceAuthorizationState(createAuthorizationState(), {
      type: "set-exits",
      bridgeExit: "203.0.113.10",
      daemonExit: "203.0.113.10",
    })
    state = reduceAuthorizationState(state, { type: "check-exit" })
    expect(state.canLaunch).toBe(true)
    state = reduceAuthorizationState(state, {
      type: "start",
      url: "http://localhost:5173/authorize",
    })
    expect(state).toMatchObject({
      step: "waiting",
      authorizationUrl: "http://localhost:5173/authorize",
    })
    state = reduceAuthorizationState(state, { type: "approved" })
    expect(state.step).toBe("completed")
    expect(reduceAuthorizationState(state, { type: "reset" })).toMatchObject({
      step: "exit",
      approved: false,
      authorizationUrl: null,
    })
  })
})
