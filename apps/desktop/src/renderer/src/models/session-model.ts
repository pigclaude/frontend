// 负责把会话桥的流式事件归并成聊天界面状态：增量合并、消息/工具去重、权限卡片、
// 换号提示、权限模式和会话提示、结果和结束状态，并把主进程错误码映射成中文文案。
// 每个动作都带 ISO UTC 时间：事件取信封时间，界面操作取操作时的时间；时间线据此显示耗时。

import type {
  SessionAccountSwitchReason,
  SessionHostEvent,
  SessionPermissionMode,
} from "../../../main/session/session-types"
import { sessionErrorView, type SessionErrorView } from "./session-errors"
import {
  addPermission,
  answerPermission,
  hasPermission,
  settlePendingPermissions,
  type SessionPermissionCard,
} from "./session-permissions"
import { appendDelta, appendMessage } from "./session-turn-blocks"

export { sessionErrorText, sessionErrorView } from "./session-errors"

/** 界面里的工具调用状态。 */
export type SessionToolStatus = "running" | "done" | "error"

/** 界面里的一次工具调用；input 只保留在内存里。开始和结束时间用来显示工具耗时。 */
export type SessionToolCall = {
  id: string
  name: string
  input: unknown
  status: SessionToolStatus
  output: string | null
  startedAt: string
  endedAt: string | null
}

/** 助手消息里的内容块顺序；工具块通过 id 指向 tools。文字块的 at 是它最后一次更新的时间。 */
export type SessionBlock =
  | { type: "text"; text: string; at: string }
  | { type: "thinking"; text: string; at: string }
  | { type: "tool"; id: string }

/** 一次换号事件；initial 只更新当前账号，不显示为换号。 */
export type SessionAccountSwitch = {
  from: string | null
  to: string
  reason: SessionAccountSwitchReason
  at: string
}

/** 界面展示的错误；warning 表示不终止会话的提示。 */
export type { SessionErrorView } from "./session-errors"

/** 一次 result 事件的用量元数据。 */
export type SessionResult = {
  subtype: string
  isError: boolean
  durationMs: number
  numTurns: number
  stopReason: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** 一轮对话的展示状态。 */
export type SessionTurnStatus = "streaming" | "waiting" | "done" | "error" | "cancelled"

/** 一轮对话：用户输入、助手块、工具、权限、换号、错误和结果；结束前 endedAt 为 null。 */
export type SessionTurn = {
  id: string
  startedAt: string
  endedAt: string | null
  userText: string | null
  blocks: SessionBlock[]
  tools: SessionToolCall[]
  permissions: SessionPermissionCard[]
  switches: SessionAccountSwitch[]
  errors: SessionErrorView[]
  result: SessionResult | null
  status: SessionTurnStatus
  seenMessageIds: string[]
}

/** 一条会话提示；每条都是新对象，同样的话再次出现也能和上一条区分。 */
export type SessionNotice = { message: string }

/** 聊天页消费的全部会话状态；不包含任何凭据。 */
export type SessionUiState = {
  sessionId: string | null
  started: boolean
  ended: boolean
  endedReason: "completed" | "stopped" | "error" | null
  model: string | null
  /** 只跟随主进程广播的模式，界面不自行假设切换成功。 */
  permissionMode: SessionPermissionMode
  accountId: string | null
  activeTurnId: string | null
  turns: SessionTurn[]
  error: SessionErrorView | null
  notice: SessionNotice | null
}

/** 会话状态机动作；事件统一包在 event 里，at 取信封时间。界面操作使用其余类型，at 取操作时间。 */
export type SessionAction =
  | { type: "starting" }
  | { type: "opened"; sessionId: string }
  | { type: "user-message"; text: string; turnId: string; at: string }
  | { type: "event"; event: SessionHostEvent; at: string }
  | { type: "permission-answered"; requestId: string; decision: "allow" | "deny"; at: string }
  | { type: "cancel-requested"; at: string }
  | { type: "stopped"; at: string }
  | { type: "failed"; message: string; code?: string; at: string }
  | { type: "clear-error" }
  | { type: "model-changed"; model: string }

/** 创建空会话状态；没有活动会话时 started 为 false。 */
export function createSessionState(): SessionUiState {
  return {
    sessionId: null,
    started: false,
    ended: false,
    endedReason: null,
    model: null,
    permissionMode: "default",
    accountId: null,
    activeTurnId: null,
    turns: [],
    error: null,
    notice: null,
  }
}

/** 归并一个动作；保证重复消息、工具结果和权限请求不会产生重复条目。 */
export function reduceSession(state: SessionUiState, action: SessionAction): SessionUiState {
  switch (action.type) {
    case "starting":
      return createSessionState()
    case "opened":
      return {
        ...state,
        sessionId: action.sessionId,
        started: true,
        ended: false,
        endedReason: null,
        error: null,
      }
    case "user-message":
      return appendTurn(state, action.turnId, action.text, action.at)
    case "event":
      return applyEvent(state, action.event, action.at)
    case "permission-answered":
      return {
        ...state,
        turns: answerPermission(state.turns, action.requestId, action.decision, action.at),
      }
    case "cancel-requested":
      // 没有活动 turn 时取消只是空操作，不能凭空造一条已取消的对话。
      if (state.activeTurnId === null) return { ...state, error: null }
      return updateActiveTurn({ ...state, error: null }, action.at, (turn) =>
        endTurn(turn, "cancelled", "denied", action.at),
      )
    case "stopped":
      return {
        ...state,
        started: false,
        ended: true,
        endedReason: "stopped",
        activeTurnId: null,
        error: null,
        turns: state.turns.map((turn) =>
          turn.status === "streaming" || turn.status === "waiting"
            ? endTurn(turn, "cancelled", "denied", action.at)
            : turn,
        ),
      }
    case "failed":
      return applyFailure(state, action.message, action.at, action.code)
    case "clear-error":
      return { ...state, error: null }
    case "model-changed":
      return { ...state, model: action.model }
    default:
      return state
  }
}

function applyEvent(state: SessionUiState, event: SessionHostEvent, at: string): SessionUiState {
  switch (event.type) {
    case "started":
      return {
        ...state,
        sessionId: event.sessionId,
        started: true,
        ended: false,
        endedReason: null,
        model: event.model,
      }
    case "mode":
      return { ...state, permissionMode: readMode(event.permissionMode, state.permissionMode) }
    case "notice":
      return { ...state, notice: { message: event.message } }
    case "delta":
      return updateActiveTurn(state, at, (turn) =>
        appendDelta(turn, event.text, event.thinking, at),
      )
    case "message":
      return updateActiveTurn(state, at, (turn) => appendMessage(turn, event, at))
    case "tool-result":
      return applyToolResult(state, event, at)
    case "permission":
      if (hasPermission(state.turns, event.requestId)) return state
      return updateActiveTurn(state, at, (turn) => addPermission(turn, event, at))
    case "account-switched":
      return applyAccountSwitch(state, { from: event.from, to: event.to, reason: event.reason, at })
    case "result":
      return {
        ...updateActiveTurn(state, at, (turn) => ({
          ...turn,
          status: event.isError ? "error" : "done",
          endedAt: turn.endedAt ?? at,
          result: {
            subtype: event.subtype,
            isError: event.isError,
            durationMs: event.durationMs,
            numTurns: event.numTurns,
            stopReason: event.stopReason,
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cacheReadTokens: event.usage.cacheReadTokens,
            cacheCreationTokens: event.usage.cacheCreationTokens,
          },
        })),
        activeTurnId: null,
      }
    case "error":
      return applyError(state, event.code, event.message, at)
    case "ended":
      return applyEnded(state, event.reason, at)
    default:
      return state
  }
}

function newTurn(id: string, userText: string | null, at: string): SessionTurn {
  return {
    id,
    startedAt: at,
    endedAt: null,
    userText,
    blocks: [],
    tools: [],
    permissions: [],
    switches: [],
    errors: [],
    result: null,
    status: "streaming",
    seenMessageIds: [],
  }
}

function appendTurn(
  state: SessionUiState,
  turnId: string,
  userText: string,
  at: string,
): SessionUiState {
  return { ...state, turns: [...state.turns, newTurn(turnId, userText, at)], activeTurnId: turnId }
}

// 没有活动轮时，事件自己开一轮，开始时间取这条事件的时间。
function updateActiveTurn(
  state: SessionUiState,
  at: string,
  update: (turn: SessionTurn) => SessionTurn,
): SessionUiState {
  const active = state.activeTurnId
  if (active !== null && state.turns.some((turn) => turn.id === active)) {
    return {
      ...state,
      turns: state.turns.map((turn) => (turn.id === active ? update(turn) : turn)),
    }
  }
  const implicitId = `turn-implicit-${state.turns.length + 1}`
  const turn = update(newTurn(implicitId, null, at))
  return { ...state, turns: [...state.turns, turn], activeTurnId: implicitId }
}

function endTurn(
  turn: SessionTurn,
  status: "done" | "error" | "cancelled",
  pending: "denied" | "timeout",
  at: string,
): SessionTurn {
  return {
    ...turn,
    status,
    endedAt: turn.endedAt ?? at,
    permissions: settlePendingPermissions(turn.permissions, pending, at),
  }
}

// 迟到事件优先落到最后一轮，避免在 result 之后凭空多出一轮没有提问的对话。
function updateLatestTurn(
  state: SessionUiState,
  update: (turn: SessionTurn) => SessionTurn,
): SessionUiState {
  if (state.turns.length === 0) return state
  const index = state.turns.length - 1
  return {
    ...state,
    turns: state.turns.map((turn, current) => (current === index ? update(turn) : turn)),
  }
}

function applyToolResult(
  state: SessionUiState,
  event: Extract<SessionHostEvent, { type: "tool-result" }>,
  at: string,
): SessionUiState {
  const finish = (tool: SessionToolCall): SessionToolCall => ({
    ...tool,
    status: event.isError ? "error" : "done",
    output: event.content,
    endedAt: at,
  })
  let found = false
  const turns = state.turns.map((turn) => {
    if (!turn.tools.some((tool) => tool.id === event.toolUseId)) return turn
    found = true
    return {
      ...turn,
      tools: turn.tools.map((tool) => (tool.id === event.toolUseId ? finish(tool) : tool)),
    }
  })
  if (found) return { ...state, turns }
  return updateActiveTurn(state, at, (turn) => ({
    ...turn,
    tools: [
      ...turn.tools,
      finish({
        id: event.toolUseId,
        name: "工具结果",
        input: null,
        status: "running",
        output: null,
        startedAt: at,
        endedAt: null,
      }),
    ],
    blocks: [...turn.blocks, { type: "tool", id: event.toolUseId }],
  }))
}

function applyAccountSwitch(state: SessionUiState, item: SessionAccountSwitch): SessionUiState {
  const next = { ...state, accountId: item.to }
  if (item.reason === "initial") return next
  // 两次 turn 之间换号只更新会话级账号，不创建没有提问的 ghost turn。
  if (state.activeTurnId === null) return next
  return updateActiveTurn(next, item.at, (turn) => {
    const last = turn.switches[turn.switches.length - 1]
    if (last?.from === item.from && last.to === item.to && last.reason === item.reason) return turn
    return { ...turn, switches: [...turn.switches, item] }
  })
}

function applyError(
  state: SessionUiState,
  code: string,
  message: string,
  at: string,
): SessionUiState {
  const error = sessionErrorView(message.startsWith(code) ? message : `${code}: ${message}`)
  if (error.warning) {
    return updateLatestTurn(state, (turn) => ({ ...turn, errors: [...turn.errors, error] }))
  }
  const isCancelled = code === "SESSION_CANCELLED" || error.code === "SESSION_CANCELLED"
  const isTimeout = code === "PERMISSION_TIMEOUT" || error.code === "PERMISSION_TIMEOUT"
  // 没有活动 turn 的取消错误不生成 ghost turn，只保留会话级提示。
  if (isCancelled && state.activeTurnId === null) return { ...state, error: null }
  const next = updateActiveTurn(state, at, (turn) => ({
    ...endTurn(turn, isCancelled ? "cancelled" : "error", isTimeout ? "timeout" : "denied", at),
    errors: [...turn.errors, error],
  }))
  return {
    ...next,
    ...(isCancelled ? {} : { error }),
  }
}

function applyEnded(
  state: SessionUiState,
  reason: "completed" | "stopped" | "error",
  at: string,
): SessionUiState {
  const status = reason === "error" ? "error" : reason === "stopped" ? "cancelled" : "done"
  return {
    ...state,
    started: false,
    ended: true,
    endedReason: reason,
    activeTurnId: null,
    turns: state.turns.map((turn) =>
      turn.status === "streaming" || turn.status === "waiting"
        ? endTurn(turn, status, "denied", at)
        : turn,
    ),
  }
}

function applyFailure(
  state: SessionUiState,
  message: string,
  at: string,
  code?: string,
): SessionUiState {
  const error = sessionErrorView(code === undefined ? message : `${code}: ${message}`)
  const next = updateActiveTurn(state, at, (turn) => ({
    ...endTurn(turn, "error", "denied", at),
    errors: [...turn.errors, error],
  }))
  return { ...next, error }
}

function readMode(value: string, current: SessionPermissionMode): SessionPermissionMode {
  if (
    value === "default" ||
    value === "acceptEdits" ||
    value === "auto" ||
    value === "plan" ||
    value === "bypassPermissions"
  ) {
    return value
  }
  return current
}
