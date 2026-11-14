// 负责验证会话里的真实时间：一轮的开始和结束取动作带来的时间，时间线上的文字、工具和权限卡片取信封时间
// 和回答时的时间。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import {
  createSessionState,
  reduceSession,
  type SessionTurn,
  type SessionUiState,
} from "./session-model"
import { projectTimeline } from "./session-timeline"

function emit(state: SessionUiState, event: SessionHostEvent, at: string): SessionUiState {
  return receive(state, event, at)
}

function activeTurn(state: SessionUiState): SessionTurn {
  const turn = state.turns[state.turns.length - 1]
  if (turn === undefined) throw new Error("expected an active turn")
  return turn
}

describe("session model times", () => {
  it("keeps the envelope times of a turn, its text, tools and permission cards", () => {
    const opened = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
    let state = reduceSession(opened, {
      type: "user-message",
      text: "跑一下测试",
      turnId: "turn-1",
      at: "2026-11-14T01:00:00.000Z",
    })
    state = emit(
      state,
      { type: "delta", text: "先跑", thinking: false, blockIndex: 0 },
      "2026-11-14T01:00:03.000Z",
    )
    state = emit(
      state,
      {
        type: "message",
        messageId: "m1",
        model: "claude-sonnet",
        parentToolUseId: null,
        blocks: [
          { type: "text", text: "先跑测试" },
          { type: "tool-use", id: "tool-1", name: "Bash", input: { command: "pnpm test" } },
        ],
      },
      "2026-11-14T01:00:04.000Z",
    )
    state = emit(
      state,
      { type: "permission", requestId: "p-1", toolName: "Bash", input: {} },
      "2026-11-14T01:00:05.000Z",
    )
    state = reduceSession(state, {
      type: "permission-answered",
      requestId: "p-1",
      decision: "allow",
      at: "2026-11-14T01:00:20.000Z",
    })
    state = emit(
      state,
      { type: "tool-result", toolUseId: "tool-1", content: "ok", isError: false },
      "2026-11-14T01:01:10.000Z",
    )
    state = emit(
      state,
      {
        type: "result",
        subtype: "success",
        isError: false,
        durationMs: 1,
        numTurns: 1,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      },
      "2026-11-14T01:01:20.000Z",
    )
    state = emit(
      state,
      { type: "turn-ended", turnId: "main-turn-1", status: "completed", errorCode: null },
      "2026-11-14T01:01:30.000Z",
    )

    const turn = activeTurn(state)
    expect([turn.startedAt, turn.endedAt]).toEqual([
      "2026-11-14T01:00:00.000Z",
      "2026-11-14T01:01:30.000Z",
    ])
    const { events } = projectTimeline({
      threadId: "thread-1",
      record: sessionRecord(state.events, state.sessionId),
      turns: state.turns,
      answers: state.answers,
    })
    const timeOf = (type: string) => events.find((event) => event.type === type)?.createdAt
    expect(events.find((event) => event.type === "message.completed")).toMatchObject({
      payload: { text: "先跑测试" },
      createdAt: "2026-11-14T01:00:04.000Z",
    })
    expect([timeOf("tool.started"), timeOf("tool.completed")]).toEqual([
      "2026-11-14T01:00:04.000Z",
      "2026-11-14T01:01:10.000Z",
    ])
    expect([timeOf("approval.requested"), timeOf("approval.resolved")]).toEqual([
      "2026-11-14T01:00:05.000Z",
      "2026-11-14T01:00:20.000Z",
    ])
  })
})
