// 负责验证会话模型按主进程的回合开闭显示一轮：result 之后后台任务还在跑时仍显示运行中，
// turn-ended 才结束这一轮；刷新后补拉到的回合也能独立成轮。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { threadView } from "./thread-view"

const at = "2026-11-14T01:00:00.000Z"
const later = "2026-11-14T01:00:40.000Z"

const firstResult: SessionHostEvent = {
  type: "result",
  subtype: "success",
  isError: false,
  durationMs: 9_882,
  numTurns: 2,
  stopReason: "end_turn",
  usage: { inputTokens: 608, outputTokens: 119, cacheReadTokens: 37_888, cacheCreationTokens: 0 },
}

function emit(state: SessionUiState, event: SessionHostEvent, time = at): SessionUiState {
  return receive(state, event, time)
}

function sentTurn(): SessionUiState {
  let state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  state = reduceSession(state, {
    type: "user-message",
    text: "后台跑一个子代理",
    turnId: "turn-1",
    at,
  })
  return emit(state, { type: "turn-started", turnId: "main-turn-1" })
}

function view(state: SessionUiState) {
  return threadView({
    state,
    threadId: "session-1",
    workspace: "/workspace",
    title: "会话",
    instanceId: "claude",
    modelId: "",
    permissionLevel: "approval-required",
    planMode: false,
    startedAt: Date.parse(at),
  })
}

function runEvents(state: SessionUiState): string[] {
  return view(state)
    .events.map((event) => event.type)
    .filter((type) => type.startsWith("run."))
}

describe("session model turns", () => {
  it("keeps the turn running after a result until the main process ends it", () => {
    let state = emit(sentTurn(), firstResult)

    expect(state.activeTurnId).toBe("turn-1")
    expect(state.turns).toHaveLength(1)
    expect(state.turns[0]).toMatchObject({ status: "streaming", endedAt: null })
    expect(runEvents(state)).toEqual(["run.started"])

    state = emit(
      state,
      { type: "turn-ended", turnId: "main-turn-1", status: "completed", errorCode: null },
      later,
    )

    expect(state.activeTurnId).toBeNull()
    expect(state.turns[0]).toMatchObject({ status: "done", endedAt: later })
    expect(runEvents(state)).toEqual(["run.started", "run.completed"])
  })

  it("keeps the continuation after a background task in the same turn", () => {
    let state = emit(sentTurn(), firstResult)
    state = emit(state, {
      type: "message",
      messageId: "m-continuation",
      model: "deepseek-v4.1-flash",
      subagent: null,
      blocks: [{ type: "text", text: "子代理已经跑完：SUB_DONE" }],
    })
    state = emit(state, { ...firstResult, numTurns: 1 })
    state = emit(state, {
      type: "turn-ended",
      turnId: "main-turn-1",
      status: "completed",
      errorCode: null,
    })

    expect(state.turns).toHaveLength(1)
    expect(state.turns[0]?.userText).toBe("后台跑一个子代理")
    expect(
      view(state)
        .events.filter((event) => event.type === "message.completed")
        .map((event) => event.payload),
    ).toEqual([{ text: "子代理已经跑完：SUB_DONE" }])
  })

  it("opens a turn for a turn the main process started without a message from this window", () => {
    let state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
    state = emit(state, { type: "turn-started", turnId: "main-turn-7" })

    expect(state.activeTurnId).toBe("main-turn-7")
    expect(state.turns).toMatchObject([{ id: "main-turn-7", userText: null, status: "streaming" }])
  })

  it("ends a stopped turn as cancelled and a failed one as an error", () => {
    const stopped = emit(emit(sentTurn(), firstResult), {
      type: "turn-ended",
      turnId: "main-turn-1",
      status: "interrupted",
      errorCode: "SESSION_CANCELLED",
    })
    const failed = emit(sentTurn(), {
      type: "turn-ended",
      turnId: "main-turn-1",
      status: "error",
      errorCode: "SDK_ERROR",
    })

    expect(stopped.turns[0]?.status).toBe("cancelled")
    expect(runEvents(stopped)).toEqual(["run.started", "run.interrupted"])
    expect(failed.turns[0]?.status).toBe("error")
    expect(failed.activeTurnId).toBeNull()
  })
})
