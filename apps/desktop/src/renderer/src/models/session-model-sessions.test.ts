// 负责验证会话模型按会话 id 区分信封：开始新会话时别的会话的信封留在存储里，
// 只有当前会话的信封改变界面状态，还不知道当前会话时跟随信封所属的会话。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"

const at = "2026-11-14T01:00:00.000Z"

function sent(sessionId: string): SessionUiState {
  const state = reduceSession(createSessionState(), { type: "opened", sessionId })
  return reduceSession(state, { type: "user-message", text: "你好", turnId: "turn-1", at })
}

function from(sessionId: string, seq: number, event: SessionHostEvent) {
  return { type: "envelope", envelope: { version: 1, sessionId, seq, at, event } } as const
}

describe("session model per session", () => {
  it("keeps the previous session's envelopes when a new session starts", () => {
    let state = receive(sent("session-1"), { type: "turn-started", turnId: "main-1" })
    state = reduceSession(state, { type: "starting" })
    state = reduceSession(state, { type: "opened", sessionId: "session-2" })

    expect(sessionRecord(state.events, "session-1").envelopes).toHaveLength(1)
    expect(sessionRecord(state.events, "session-2").envelopes).toEqual([])
    expect(state.turns).toEqual([])
  })

  it("stores another session's envelopes without touching the current turns", () => {
    const current = receive(sent("session-2"), { type: "turn-started", turnId: "main-2" })
    let state = reduceSession(
      current,
      from("session-1", 7, {
        type: "turn-ended",
        turnId: "main-1",
        status: "error",
        errorCode: "SDK_ERROR",
      }),
    )
    state = reduceSession(state, from("session-1", 8, { type: "ended", reason: "error" }))

    expect(state.turns).toEqual(current.turns)
    expect(state.activeTurnId).toBe("turn-1")
    expect(state.ended).toBe(false)
    expect(sessionRecord(state.events, "session-1").envelopes.map((item) => item.seq)).toEqual([
      7, 8,
    ])
  })

  it("follows the session its envelopes come from when no session is known yet", () => {
    const state = reduceSession(
      createSessionState(),
      from("session-9", 1, { type: "mode", permissionMode: "plan" }),
    )

    expect(state.sessionId).toBe("session-9")
    expect(state.permissionMode).toBe("plan")
  })
})
