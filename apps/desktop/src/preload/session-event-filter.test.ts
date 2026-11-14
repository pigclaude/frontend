// 负责验证预加载脚本的会话事件过滤：会话宿主广播的每种事件都交给渲染进程，其他值丢弃。

import { describe, expect, it } from "vitest"
import { isSessionEvent } from "./session-event-filter"

describe("session event filter", () => {
  it("passes the mode changes and notices the host announces", () => {
    expect(isSessionEvent({ type: "mode", permissionMode: "auto" })).toBe(true)
    expect(isSessionEvent({ type: "notice", message: "自动审批不可用" })).toBe(true)
  })

  it("passes the conversation events", () => {
    const types = [
      "started",
      "delta",
      "message",
      "tool-result",
      "permission",
      "account-switched",
      "result",
      "error",
      "ended",
    ]
    for (const type of types) expect(isSessionEvent({ type }), type).toBe(true)
  })

  it("drops values that are not session events", () => {
    expect(isSessionEvent({ type: "status", permissionMode: "auto" })).toBe(false)
    expect(isSessionEvent({ type: "toString" })).toBe(false)
    expect(isSessionEvent({ type: 1 })).toBe(false)
    expect(isSessionEvent("mode")).toBe(false)
    expect(isSessionEvent(null)).toBe(false)
  })
})
