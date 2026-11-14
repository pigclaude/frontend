// 负责验证工作台什么时候重读项目：每个工具调用结束、每轮结束都让版本号前进，进行中的不算。
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { workspaceRevision } from "./workspace-revision"

const t0 = "2026-11-14T00:00:00.000Z"

function sent(state: SessionUiState, turnId: string, mainTurnId: string): SessionUiState {
  const next = reduceSession(state, { type: "user-message", text: "go", turnId, at: t0 })
  return receive(next, { type: "turn-started", turnId: mainTurnId })
}

function called(state: SessionUiState, id: string): SessionUiState {
  return receive(state, {
    type: "message",
    messageId: `m-${id}`,
    model: "claude-sonnet",
    parentToolUseId: null,
    blocks: [{ type: "tool-use", id, name: "Edit", input: {} }],
  })
}

function finished(state: SessionUiState, id: string, isError = false): SessionUiState {
  return receive(state, { type: "tool-result", toolUseId: id, content: "", isError })
}

function ended(state: SessionUiState, mainTurnId: string): SessionUiState {
  const event: SessionHostEvent = {
    type: "turn-ended",
    turnId: mainTurnId,
    status: "completed",
    errorCode: null,
  }
  return receive(state, event)
}

describe("workspaceRevision", () => {
  it("moves forward when a tool call finishes during a turn and when the turn ends", () => {
    const opened = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
    const running = called(sent(opened, "turn-1", "main-1"), "a")
    const oneDone = finished(called(running, "b"), "a")
    const twoDone = finished(oneDone, "b", true)
    const firstEnded = ended(twoDone, "main-1")
    const second = called(finished(called(sent(firstEnded, "turn-2", "main-2"), "c"), "c"), "d")

    expect(workspaceRevision(opened)).toBe(0)
    expect(workspaceRevision(running)).toBe(0)
    expect(workspaceRevision(oneDone)).toBe(1)
    expect(workspaceRevision(twoDone)).toBe(2)
    expect(workspaceRevision(firstEnded)).toBe(3)
    expect(workspaceRevision(second)).toBe(4)
    expect(workspaceRevision(finished(second, "c"))).toBe(4)
  })
})
