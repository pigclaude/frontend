// 负责验证预加载脚本的会话信封校验：会话宿主广播的每种事件都交给渲染进程，信封不完整或不一致的值丢弃。

import { describe, expect, it } from "vitest"
import { isSessionEnvelope } from "./session-event-filter"

const at = "2026-11-14T01:00:00.000Z"

function envelope(event: unknown, overrides: Record<string, unknown> = {}): unknown {
  return { version: 1, sessionId: "session-1", seq: 1, at, event, ...overrides }
}

describe("session envelope filter", () => {
  it("passes the mode changes and notices the host announces", () => {
    expect(isSessionEnvelope(envelope({ type: "mode", permissionMode: "auto" }))).toBe(true)
    expect(isSessionEnvelope(envelope({ type: "notice", message: "自动审批不可用" }))).toBe(true)
  })

  it("passes the conversation events", () => {
    const types = [
      "started",
      "message",
      "tool-result",
      "permission",
      "account-switched",
      "result",
      "error",
      "ended",
    ]
    for (const type of types) expect(isSessionEnvelope(envelope({ type })), type).toBe(true)
    expect(isSessionEnvelope(envelope({ type: "delta" }, { seq: null }))).toBe(true)
  })

  it("passes host notices that belong to no session", () => {
    expect(isSessionEnvelope(envelope({ type: "notice" }, { sessionId: null, seq: null }))).toBe(
      true,
    )
  })

  it("drops values that are not session events", () => {
    expect(isSessionEnvelope(envelope({ type: "status", permissionMode: "auto" }))).toBe(false)
    expect(isSessionEnvelope(envelope({ type: "toString" }))).toBe(false)
    expect(isSessionEnvelope(envelope({ type: 1 }))).toBe(false)
    expect(isSessionEnvelope(envelope("mode"))).toBe(false)
    expect(isSessionEnvelope({ type: "mode", permissionMode: "auto" })).toBe(false)
    expect(isSessionEnvelope(null)).toBe(false)
  })

  it("drops envelopes whose version, time, session or seq do not fit the event", () => {
    const message = { type: "message" }
    expect(isSessionEnvelope(envelope(message, { version: 2 }))).toBe(false)
    expect(isSessionEnvelope(envelope(message, { at: "2026-11-14 01:00:00" }))).toBe(false)
    expect(isSessionEnvelope(envelope(message, { at: "2026-11-14T09:00:00.000+08:00" }))).toBe(
      false,
    )
    expect(isSessionEnvelope(envelope(message, { sessionId: "" }))).toBe(false)
    expect(isSessionEnvelope(envelope(message, { seq: null }))).toBe(false)
    expect(isSessionEnvelope(envelope(message, { seq: 0 }))).toBe(false)
    expect(isSessionEnvelope(envelope(message, { seq: 1.5 }))).toBe(false)
    expect(isSessionEnvelope(envelope({ type: "delta" }, { seq: 4 }))).toBe(false)
    expect(isSessionEnvelope(envelope({ type: "notice" }, { sessionId: null, seq: 2 }))).toBe(false)
  })
})
