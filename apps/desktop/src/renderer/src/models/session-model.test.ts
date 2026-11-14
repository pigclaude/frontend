// 负责验证会话模型：信封交给按会话组织的存储后，流式增量、消息和工具去重、权限卡片、换号在时间线上的结果，
// 一轮的开闭、结果和结束和界面操作。错误码文案和超时见 session-model-errors.test.ts。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import {
  createSessionState,
  reduceSession,
  type SessionAction,
  type SessionTurn,
  type SessionUiState,
} from "./session-model"
import {
  pendingPermission,
  permissionCards,
  type SessionPermissionCard,
} from "./session-permissions"
import { sessionRuns } from "./session-runs"
import { projectTimeline, type SessionTimeline } from "./session-timeline"

const sessionTime = "2026-11-14T01:00:00.000Z"
const turnEnded: SessionHostEvent = {
  type: "turn-ended",
  turnId: "main-turn-1",
  status: "completed",
  errorCode: null,
}

function apply(state: SessionUiState, action: SessionAction): SessionUiState {
  return reduceSession(state, action)
}

function emit(state: SessionUiState, event: SessionHostEvent, at = sessionTime): SessionUiState {
  return receive(state, event, at)
}

function timeline(state: SessionUiState): SessionTimeline {
  return projectTimeline({
    threadId: "thread-1",
    record: sessionRecord(state.events, state.sessionId),
    turns: state.turns,
    answers: state.answers,
  })
}

function payloads(state: SessionUiState, type: string): unknown[] {
  return timeline(state)
    .events.filter((event) => event.type === type)
    .map((event) => event.payload)
}

function cards(state: SessionUiState): SessionPermissionCard[] {
  const record = sessionRecord(state.events, state.sessionId)
  return sessionRuns(record.envelopes, state.turns).flatMap((run) =>
    permissionCards(run, state.answers),
  )
}

function ended(state: SessionUiState): SessionUiState {
  return emit(state, turnEnded)
}

function activeTurn(state: SessionUiState): SessionTurn {
  const turn = state.turns[state.turns.length - 1]
  if (turn === undefined) throw new Error("expected an active turn")
  return turn
}

function startedTurn(): SessionUiState {
  let state = createSessionState()
  state = apply(state, { type: "starting" })
  state = apply(state, { type: "opened", sessionId: "session-1" })
  return apply(state, {
    type: "user-message",
    text: "改一下重试逻辑",
    turnId: "turn-1",
    at: sessionTime,
  })
}

describe("session model", () => {
  it("starts empty and ready to receive events", () => {
    const state = createSessionState()

    expect(state.turns).toEqual([])
    expect(state.started).toBe(false)
    expect(state.ended).toBe(false)
    expect(state.error).toBeNull()
    expect(state.activeTurnId).toBeNull()
  })

  it("merges text and thinking deltas into one block each", () => {
    let state = startedTurn()
    state = emit(state, { type: "delta", text: "先看", thinking: false, blockIndex: 0 })
    state = emit(state, { type: "delta", text: "一下", thinking: false, blockIndex: 0 })
    state = emit(state, { type: "delta", text: "判断", thinking: true, blockIndex: 1 })
    state = emit(state, { type: "delta", text: "条件", thinking: true, blockIndex: 1 })

    expect(sessionRecord(state.events, "session-1").live).toEqual({
      text: "先看一下",
      reasoning: "判断条件",
    })
    expect(timeline(state)).toMatchObject({ streamingText: "先看一下", liveReasoning: "判断条件" })
  })

  it("does not duplicate text already streamed when the full message arrives", () => {
    let state = startedTurn()
    state = emit(state, { type: "delta", text: "先看", thinking: false, blockIndex: 0 })
    state = emit(state, {
      type: "message",
      messageId: "m1",
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks: [{ type: "text", text: "先看一下" }],
    })

    expect(timeline(state).streamingText).toBe("先看一下")
    expect(payloads(ended(state), "message.completed")).toEqual([{ text: "先看一下" }])
  })

  it("appends later text after a tool call instead of merging into earlier text", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "message",
      messageId: "m1",
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks: [
        { type: "text", text: "先读文件" },
        { type: "tool-use", id: "tool-1", name: "Read", input: { file: "a.ts" } },
      ],
    })
    state = emit(state, {
      type: "message",
      messageId: "m2",
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks: [{ type: "text", text: "读完了" }],
    })

    const events = timeline(ended(state)).events
    expect(events.map((event) => [event.type, event.createdAt])).toEqual([
      ["run.started", sessionTime],
      ["message.completed", sessionTime],
      ["tool.started", sessionTime],
      ["message.completed", sessionTime],
      ["run.completed", sessionTime],
    ])
    expect(events[1]?.payload).toEqual({ text: "先读文件" })
    expect(events[3]?.payload).toEqual({ text: "读完了" })
  })

  it("deduplicates assistant messages and tool calls by id", () => {
    let state = startedTurn()
    const message: SessionHostEvent = {
      type: "message",
      messageId: "m1",
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks: [{ type: "tool-use", id: "tool-1", name: "Read", input: { file: "a.ts" } }],
    }
    state = emit(state, message)
    state = emit(state, message)
    state = emit(state, {
      type: "tool-result",
      toolUseId: "tool-1",
      content: "done",
      isError: false,
    })
    state = emit(state, {
      type: "tool-result",
      toolUseId: "tool-1",
      content: "done",
      isError: false,
    })

    expect(payloads(state, "tool.started")).toEqual([
      { toolCallId: "tool-1", name: "Read", input: { file: "a.ts" } },
    ])
    expect(payloads(state, "tool.completed")).toEqual([
      { toolCallId: "tool-1", name: "Read", output: "done", isError: false },
    ])
  })

  it("keeps tool blocks that arrive later under the same message id", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "message",
      messageId: "m1",
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks: [{ type: "thinking", text: "先看一下" }],
    })
    state = emit(state, {
      type: "message",
      messageId: "m1",
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks: [
        { type: "thinking", text: "先看一下" },
        { type: "tool-use", id: "tool-1", name: "Bash", input: { command: "ls" } },
      ],
    })
    state = emit(state, {
      type: "tool-result",
      toolUseId: "tool-1",
      content: "bin",
      isError: false,
    })

    expect(payloads(state, "tool.completed")).toEqual([
      { toolCallId: "tool-1", name: "Bash", output: "bin", isError: false },
    ])
    expect(timeline(state).events.map((event) => event.type)).toEqual([
      "run.started",
      "reasoning.completed",
      "tool.started",
      "tool.completed",
    ])
  })

  it("keeps one permission card per request and records allow or deny", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "permission",
      requestId: "permission-1",
      toolName: "Bash",
      input: { command: "pnpm test" },
    })
    state = emit(state, {
      type: "permission",
      requestId: "permission-1",
      toolName: "Bash",
      input: { command: "pnpm test" },
    })

    expect(cards(state)).toHaveLength(1)
    expect(cards(state)[0]?.status).toBe("pending")
    expect(pendingPermission(state)?.requestId).toBe("permission-1")

    state = apply(state, {
      type: "permission-answered",
      requestId: "permission-1",
      decision: "allow",
      at: sessionTime,
    })
    expect(cards(state)[0]?.status).toBe("allowed")
    expect(pendingPermission(state)).toBeNull()
    expect(activeTurn(state).status).toBe("streaming")

    state = emit(state, {
      type: "permission",
      requestId: "permission-2",
      toolName: "Write",
      input: { file: "b.ts" },
    })
    state = apply(state, {
      type: "permission-answered",
      requestId: "permission-2",
      decision: "deny",
      at: sessionTime,
    })
    expect(cards(state)[1]?.status).toBe("denied")
  })

  it("records account switches and ignores the initial account selection notice", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "account-switched",
      from: null,
      to: "account-a",
      reason: "initial",
    })
    expect(state.accountId).toBe("account-a")
    expect(payloads(state, "thread.updated")).toEqual([])

    state = emit(state, {
      type: "account-switched",
      from: "account-a",
      to: "account-b",
      reason: "quota",
    })
    expect(state.accountId).toBe("account-b")
    expect(timeline(state).events.filter((event) => event.type === "thread.updated")).toEqual([
      expect.objectContaining({
        runId: null,
        payload: { agentId: "account-b" },
        createdAt: sessionTime,
      }),
    ])
  })

  it("shows only the permission mode the host announces", () => {
    let state = emit(startedTurn(), { type: "mode", permissionMode: "auto" })
    expect(state.permissionMode).toBe("auto")

    state = emit(state, {
      type: "started",
      sessionId: "native-1",
      model: "claude-sonnet",
      tools: [],
      permissionMode: "default",
    })
    expect(state.permissionMode).toBe("auto")
    expect(emit(state, { type: "mode", permissionMode: "dontAsk" }).permissionMode).toBe("auto")
  })

  it("keeps each notice as a new entry even when the text repeats", () => {
    const message = "自动审批不可用：当前模型不支持。会话按监督审批运行。"
    const first = emit(startedTurn(), { type: "notice", message })
    const second = emit(first, { type: "notice", message })

    expect(first.notice).toEqual({ message })
    expect(second.notice).toEqual({ message })
    expect(second.notice).not.toBe(first.notice)
    expect(second.turns).toEqual(first.turns)
    expect(apply(second, { type: "starting" }).notice).toBeNull()
  })

  it("stores result usage, ends the turn when the main process does and then ends the session", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "result",
      subtype: "success",
      isError: false,
      durationMs: 1_200,
      numTurns: 1,
      stopReason: "end_turn",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 10,
        cacheCreationTokens: 5,
      },
    })
    state = emit(state, turnEnded)

    expect(activeTurn(state).status).toBe("done")
    const kept = sessionRecord(state.events, "session-1").envelopes.map(({ event }) => event)
    expect(kept.find((event) => event.type === "result")).toMatchObject({
      durationMs: 1_200,
      usage: { outputTokens: 20 },
    })
    expect(state.activeTurnId).toBeNull()

    state = emit(state, { type: "ended", reason: "completed" })
    expect(state.ended).toBe(true)
    expect(state.endedReason).toBe("completed")
    expect(state.started).toBe(false)
  })

  it("allows a new session after the previous one ended or stopped", () => {
    let ended = startedTurn()
    ended = emit(ended, { type: "ended", reason: "completed" })
    ended = apply(ended, { type: "starting" })
    ended = apply(ended, { type: "opened", sessionId: "session-2" })
    expect(ended.started).toBe(true)
    expect(ended.sessionId).toBe("session-2")
    expect(ended.turns).toEqual([])

    let stopped = startedTurn()
    stopped = apply(stopped, { type: "stopped", at: sessionTime })
    expect(stopped.started).toBe(false)
    stopped = apply(stopped, { type: "starting" })
    stopped = apply(stopped, { type: "opened", sessionId: "session-3" })
    expect(stopped.started).toBe(true)
    expect(stopped.turns).toEqual([])
  })

  it("marks the turn cancelled on cancel and stopped on stop", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "permission",
      requestId: "permission-1",
      toolName: "Bash",
      input: { command: "pnpm test" },
    })
    state = apply(state, { type: "cancel-requested", at: sessionTime })

    expect(activeTurn(state).status).toBe("cancelled")
    expect(cards(state)[0]?.status).toBe("denied")

    state = apply(state, { type: "stopped", at: sessionTime })
    expect(state.ended).toBe(true)
    expect(state.endedReason).toBe("stopped")
  })

  it("does not create a ghost turn when cancel arrives before any user message", () => {
    let state = createSessionState()
    state = apply(state, { type: "opened", sessionId: "session-1" })

    state = apply(state, { type: "cancel-requested", at: sessionTime })
    state = emit(state, { type: "error", code: "SESSION_CANCELLED", message: "当前请求已取消" })

    expect(state.turns).toEqual([])
    expect(state.activeTurnId).toBeNull()
    expect(state.error).toBeNull()
  })

  it("does not create a ghost turn when the account switches between turns", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "result",
      subtype: "success",
      isError: false,
      durationMs: 10,
      numTurns: 1,
      stopReason: "end_turn",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    })
    state = emit(state, turnEnded)
    state = emit(state, {
      type: "account-switched",
      from: "account-a",
      to: "account-b",
      reason: "switch",
    })

    expect(state.accountId).toBe("account-b")
    expect(state.turns).toHaveLength(1)
    expect(payloads(state, "thread.updated")).toEqual([])
    expect(state.activeTurnId).toBeNull()
  })
})
