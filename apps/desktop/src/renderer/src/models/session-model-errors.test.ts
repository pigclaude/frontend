// 负责验证会话错误：主进程错误码映射成中文文案、提示性错误不终止会话，以及权限询问超时把没回答的卡片
// 结算为超时并记下致命错误。

import { describe, expect, it } from "vitest"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import {
  createSessionState,
  reduceSession,
  sessionErrorText,
  sessionErrorView,
  type SessionTurn,
  type SessionUiState,
} from "./session-model"
import { permissionCards, type SessionPermissionCard } from "./session-permissions"
import { sessionRuns } from "./session-runs"

const sessionTime = "2026-11-14T01:00:00.000Z"

function startedTurn(): SessionUiState {
  const state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  return reduceSession(state, {
    type: "user-message",
    text: "改一下重试逻辑",
    turnId: "turn-1",
    at: sessionTime,
  })
}

function activeTurn(state: SessionUiState): SessionTurn {
  const turn = state.turns[state.turns.length - 1]
  if (turn === undefined) throw new Error("expected an active turn")
  return turn
}

function cards(state: SessionUiState): SessionPermissionCard[] {
  const record = sessionRecord(state.events, state.sessionId)
  return sessionRuns(record.envelopes, state.turns).flatMap((run) =>
    permissionCards(run, state.answers),
  )
}

const emit = receive

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

    expect(cards(state)[0]?.status).toBe("timeout")
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
