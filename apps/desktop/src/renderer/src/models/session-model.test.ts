// 负责验证会话事件归并：流式增量合并、消息和工具去重、权限卡片、换号事件、结果/结束和错误码中文文案。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import {
  createSessionState,
  reduceSession,
  sessionErrorText,
  sessionErrorView,
  type SessionAction,
  type SessionTurn,
  type SessionUiState,
} from "./session-model"

function apply(state: SessionUiState, action: SessionAction): SessionUiState {
  return reduceSession(state, action)
}

function emit(state: SessionUiState, event: SessionHostEvent): SessionUiState {
  return apply(state, { type: "event", event })
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
  return apply(state, { type: "user-message", text: "改一下重试逻辑", turnId: "turn-1" })
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

    expect(activeTurn(state).blocks).toEqual([
      { type: "text", text: "先看一下" },
      { type: "thinking", text: "判断条件" },
    ])
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

    expect(activeTurn(state).blocks).toEqual([{ type: "text", text: "先看一下" }])
    expect(activeTurn(state).seenMessageIds).toEqual(["m1"])
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

    expect(activeTurn(state).blocks).toEqual([
      { type: "text", text: "先读文件" },
      { type: "tool", id: "tool-1" },
      { type: "text", text: "读完了" },
    ])
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

    const turn = activeTurn(state)
    expect(turn.tools).toHaveLength(1)
    expect(turn.tools[0]).toMatchObject({
      id: "tool-1",
      name: "Read",
      status: "done",
      output: "done",
    })
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

    expect(activeTurn(state).permissions).toHaveLength(1)
    expect(activeTurn(state).permissions[0]?.status).toBe("pending")
    expect(activeTurn(state).status).toBe("waiting")

    state = apply(state, {
      type: "permission-answered",
      requestId: "permission-1",
      decision: "allow",
    })
    expect(activeTurn(state).permissions[0]?.status).toBe("allowed")
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
    })
    expect(activeTurn(state).permissions[1]?.status).toBe("denied")
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
    expect(activeTurn(state).switches).toEqual([])

    state = emit(state, {
      type: "account-switched",
      from: "account-a",
      to: "account-b",
      reason: "quota",
    })
    expect(state.accountId).toBe("account-b")
    expect(activeTurn(state).switches).toEqual([
      { from: "account-a", to: "account-b", reason: "quota" },
    ])
  })

  it("stores result usage and ends the session", () => {
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

    expect(activeTurn(state).status).toBe("done")
    expect(activeTurn(state).result).toMatchObject({ durationMs: 1_200, outputTokens: 20 })
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
    stopped = apply(stopped, { type: "stopped" })
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
    state = apply(state, { type: "cancel-requested" })

    expect(activeTurn(state).status).toBe("cancelled")
    expect(activeTurn(state).permissions[0]?.status).toBe("denied")

    state = apply(state, { type: "stopped" })
    expect(state.ended).toBe(true)
    expect(state.endedReason).toBe("stopped")
  })
})

describe("session error text", () => {
  it("maps known IPC error codes to Chinese text", () => {
    expect(sessionErrorText("WORKSPACE_UNAVAILABLE: 路径不存在")).toBe("工作区不存在或不可读")
    expect(sessionErrorText("NO_AVAILABLE_ACCOUNT: 没有可用的 Claude 账号")).toBe(
      "没有可用的 Claude 账号，请添加或重新授权",
    )
    expect(sessionErrorText("PERMISSION_TIMEOUT: 权限询问超时")).toBe("权限询问超时，已拒绝")
    expect(sessionErrorText("SESSION_CANCELLED: 当前请求已取消")).toBe("已取消当前请求")
  })

  it("accepts lowercase usage_write_failed and strips the Electron prefix", () => {
    expect(sessionErrorText("usage_write_failed: 写入失败")).toBe("用量记录写入失败，不影响会话")
    expect(
      sessionErrorText(
        "Error invoking remote method 'pigclaude:session-start': Error: MEMBERSHIP_REQUIRED: 会员状态不可用",
      ),
    ).toBe("会员状态不可用，请重新登录")
  })

  it("keeps the detail for unknown codes and exposes warning state", () => {
    expect(sessionErrorText("NEW_CODE: 原始描述")).toBe("原始描述")

    const warning = sessionErrorView("usage_write_failed: 写入失败")
    expect(warning).toMatchObject({ warning: true })
    const fatal = sessionErrorView("PROXY_UNAVAILABLE: 代理不可用")
    expect(fatal).toMatchObject({ code: "PROXY_UNAVAILABLE", warning: false })
    expect(fatal.message).toBe("账号代理不可用，请检查代理")
  })

  it("marks pending permissions as timed out and records a fatal error", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "permission",
      requestId: "permission-1",
      toolName: "Bash",
      input: { command: "pnpm test" },
    })
    state = emit(state, {
      type: "error",
      code: "PERMISSION_TIMEOUT",
      message: "权限询问超时",
    })

    expect(activeTurn(state).permissions[0]?.status).toBe("timeout")
    expect(activeTurn(state).status).toBe("error")
    expect(state.error?.message).toBe("权限询问超时，已拒绝")
  })

  it("does not turn a usage write warning into a fatal session error", () => {
    let state = startedTurn()
    state = emit(state, { type: "error", code: "usage_write_failed", message: "用量记录写入失败" })

    expect(state.error).toBeNull()
    expect(activeTurn(state).errors.at(-1)).toMatchObject({ warning: true })
  })

  it("attaches a late usage warning to the finished turn instead of adding a ghost turn", () => {
    let state = startedTurn()
    state = emit(state, {
      type: "result",
      subtype: "success",
      isError: false,
      durationMs: 500,
      numTurns: 1,
      stopReason: "end_turn",
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    })
    state = emit(state, { type: "error", code: "usage_write_failed", message: "用量记录写入失败" })

    expect(state.turns).toHaveLength(1)
    expect(state.turns[0]?.errors.at(-1)).toMatchObject({ warning: true })
  })
})
