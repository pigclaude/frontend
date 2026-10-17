// 负责验证登录/注册浏览器授权状态机的意图、等待、完成和失败恢复。
import { describe, expect, it } from "vitest"
import { createLoginState, reduceLoginState } from "./login-model"

describe("browser login model", () => {
  it("keeps login and register as separate browser intents", () => {
    const login = reduceLoginState(createLoginState(), { type: "start-request", intent: "login" })
    const register = reduceLoginState(createLoginState(), {
      type: "start-request",
      intent: "register",
    })

    expect(login).toMatchObject({ view: "starting", intent: "login" })
    expect(register).toMatchObject({ view: "starting", intent: "register" })
  })

  it("shows a waiting URL and completes without exposing any secret", () => {
    const started = reduceLoginState(createLoginState(), {
      type: "started",
      intent: "login",
      sessionId: "session-1",
      authorizationUrl: "http://localhost:5173/authorize?state=one",
      expiresAt: 601_000,
    })
    const completed = reduceLoginState(started, {
      type: "completed",
      intent: "login",
      sessionId: "session-1",
      displayName: "林舟",
      expiresAt: 2_000_000,
    })

    expect(started).toMatchObject({
      view: "waiting",
      authorizationUrl: expect.stringContaining("state=one"),
    })
    expect(completed).toMatchObject({ view: "success", displayName: "林舟" })
    expect(completed).not.toHaveProperty("accessToken")
    expect(completed).not.toHaveProperty("refreshToken")
  })

  it("returns to a retryable idle state after cancel or failure", () => {
    const waiting = reduceLoginState(createLoginState(), {
      type: "started",
      intent: "register",
      sessionId: "session-2",
      authorizationUrl: "http://localhost:5173/authorize",
      expiresAt: 601_000,
    })

    expect(reduceLoginState(waiting, { type: "cancelled" })).toMatchObject({ view: "idle" })
    expect(reduceLoginState(waiting, { type: "failed", error: "授权已过期" })).toMatchObject({
      view: "error",
      error: "授权已过期",
      intent: "register",
    })
  })
})
