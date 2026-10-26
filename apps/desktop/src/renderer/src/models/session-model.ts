// 负责把会话桥的流式事件归并成聊天界面状态：增量合并、消息/工具去重、权限卡片、
// 换号提示、结果和结束状态，并把主进程错误码映射成中文文案。

import type {
  SessionAccountSwitchReason,
  SessionHostEvent,
  SessionPermissionMode,
} from "../../../main/session/session-types"
import { sessionErrorView, type SessionErrorView } from "./session-errors"
import { appendDelta, appendMessage } from "./session-turn-blocks"

export { sessionErrorText, sessionErrorView } from "./session-errors"

/** 界面里的工具调用状态。 */
export type SessionToolStatus = "running" | "done" | "error"

/** 界面里的一次工具调用；input 只保留在内存里。 */
export type SessionToolCall = {
  id: string
  name: string
  input: unknown
  status: SessionToolStatus
  output: string | null
}

/** 助手消息里的内容块顺序；工具块通过 id 指向 tools。 */
export type SessionBlock =
  { type: "text"; text: string } | { type: "thinking"; text: string } | { type: "tool"; id: string }

/** 权限卡片的结算状态。 */
export type SessionPermissionStatus = "pending" | "allowed" | "denied" | "timeout"

/** 一张需要回答或已经回答的权限卡片。 */
export type SessionPermissionCard = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  suggestions: unknown[]
  blockedPath: string | null
  status: SessionPermissionStatus
}

/** 一次换号事件；initial 只更新当前账号，不显示为换号。 */
export type SessionAccountSwitch = {
  from: string | null
  to: string
  reason: SessionAccountSwitchReason
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

/** 一轮对话：用户输入、助手块、工具、权限、换号、错误和结果。 */
export type SessionTurn = {
  id: string
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

/** 聊天页消费的全部会话状态；不包含任何凭据。 */
export type SessionUiState = {
  sessionId: string | null
  started: boolean
  ended: boolean
  endedReason: "completed" | "stopped" | "error" | null
  model: string | null
  permissionMode: SessionPermissionMode
  accountId: string | null
  activeTurnId: string | null
  turns: SessionTurn[]
  error: SessionErrorView | null
}

/** 会话状态机动作；事件统一包在 event 里，界面操作使用其余类型。 */
export type SessionAction =
  | { type: "starting" }
  | { type: "opened"; sessionId: string }
  | { type: "user-message"; text: string; turnId: string }
  | { type: "event"; event: SessionHostEvent }
  | { type: "permission-answered"; requestId: string; decision: "allow" | "deny" }
  | { type: "cancel-requested" }
  | { type: "stopped" }
  | { type: "failed"; message: string; code?: string }
  | { type: "clear-error" }
  | { type: "mode-changed"; mode: SessionPermissionMode }
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
      return appendTurn(state, action.turnId, action.text)
    case "event":
      return applyEvent(state, action.event)
    case "permission-answered":
      return answerPermission(state, action.requestId, action.decision)
    case "cancel-requested":
      return updateActiveTurn({ ...state, error: null }, (turn) => ({
        ...turn,
        status: "cancelled",
        permissions: settlePendingPermissions(turn.permissions, "denied"),
      }))
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
            ? {
                ...turn,
                status: "cancelled",
                permissions: settlePendingPermissions(turn.permissions, "denied"),
              }
            : turn,
        ),
      }
    case "failed":
      return applyFailure(state, action.message, action.code)
    case "clear-error":
      return { ...state, error: null }
    case "mode-changed":
      return { ...state, permissionMode: action.mode }
    case "model-changed":
      return { ...state, model: action.model }
    default:
      return state
  }
}

function applyEvent(state: SessionUiState, event: SessionHostEvent): SessionUiState {
  switch (event.type) {
    case "started":
      return {
        ...state,
        sessionId: event.sessionId,
        started: true,
        ended: false,
        endedReason: null,
        model: event.model,
        permissionMode: readMode(event.permissionMode),
      }
    case "delta":
      return updateActiveTurn(state, (turn) => appendDelta(turn, event.text, event.thinking))
    case "message":
      return updateActiveTurn(state, (turn) => appendMessage(turn, event))
    case "tool-result":
      return applyToolResult(state, event.toolUseId, event.content, event.isError)
    case "permission":
      return applyPermission(state, event)
    case "account-switched":
      return applyAccountSwitch(state, event.from, event.to, event.reason)
    case "result":
      return {
        ...updateActiveTurn(state, (turn) => ({
          ...turn,
          status: event.isError ? "error" : "done",
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
      return applyError(state, event.code, event.message)
    case "ended":
      return applyEnded(state, event.reason)
    default:
      return state
  }
}

function appendTurn(state: SessionUiState, turnId: string, userText: string): SessionUiState {
  const turn: SessionTurn = {
    id: turnId,
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
  return { ...state, turns: [...state.turns, turn], activeTurnId: turnId }
}

function updateActiveTurn(
  state: SessionUiState,
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
  const turn = update({
    id: implicitId,
    userText: null,
    blocks: [],
    tools: [],
    permissions: [],
    switches: [],
    errors: [],
    result: null,
    status: "streaming",
    seenMessageIds: [],
  })
  return { ...state, turns: [...state.turns, turn], activeTurnId: implicitId }
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
  toolUseId: string,
  content: string,
  isError: boolean,
): SessionUiState {
  let found = false
  const turns = state.turns.map((turn) => {
    if (!turn.tools.some((tool) => tool.id === toolUseId)) return turn
    found = true
    return {
      ...turn,
      tools: turn.tools.map((tool) =>
        tool.id === toolUseId
          ? { ...tool, status: isError ? ("error" as const) : ("done" as const), output: content }
          : tool,
      ),
    }
  })
  if (found) return { ...state, turns }
  return updateActiveTurn(state, (turn) => {
    const existing = turn.tools.find((tool) => tool.id === toolUseId)
    if (existing !== undefined) {
      return {
        ...turn,
        tools: turn.tools.map((tool) =>
          tool.id === toolUseId
            ? { ...tool, status: isError ? ("error" as const) : ("done" as const), output: content }
            : tool,
        ),
      }
    }
    return {
      ...turn,
      tools: [
        ...turn.tools,
        {
          id: toolUseId,
          name: "工具结果",
          input: null,
          status: isError ? ("error" as const) : ("done" as const),
          output: content,
        },
      ],
      blocks: [...turn.blocks, { type: "tool", id: toolUseId }],
    }
  })
}

function applyPermission(
  state: SessionUiState,
  event: Extract<SessionHostEvent, { type: "permission" }>,
): SessionUiState {
  const duplicate = state.turns.some((turn) =>
    turn.permissions.some((card) => card.requestId === event.requestId),
  )
  if (duplicate) return state
  return updateActiveTurn(state, (turn) => ({
    ...turn,
    status: "waiting",
    permissions: [
      ...turn.permissions,
      {
        requestId: event.requestId,
        toolName: event.toolName,
        input: event.input,
        suggestions: event.suggestions ?? [],
        blockedPath: event.blockedPath ?? null,
        status: "pending",
      },
    ],
  }))
}

function applyAccountSwitch(
  state: SessionUiState,
  from: string | null,
  to: string,
  reason: SessionAccountSwitchReason,
): SessionUiState {
  const next = { ...state, accountId: to }
  if (reason === "initial") return next
  return updateActiveTurn(next, (turn) => {
    const last = turn.switches[turn.switches.length - 1]
    if (last?.from === from && last.to === to && last.reason === reason) return turn
    return { ...turn, switches: [...turn.switches, { from, to, reason }] }
  })
}

function applyError(state: SessionUiState, code: string, message: string): SessionUiState {
  const error = sessionErrorView(message.startsWith(code) ? message : `${code}: ${message}`)
  if (error.warning) {
    return updateLatestTurn(state, (turn) => ({ ...turn, errors: [...turn.errors, error] }))
  }
  const isCancelled = code === "SESSION_CANCELLED" || error.code === "SESSION_CANCELLED"
  const isTimeout = code === "PERMISSION_TIMEOUT" || error.code === "PERMISSION_TIMEOUT"
  const next = updateActiveTurn(state, (turn) => ({
    ...turn,
    status: isCancelled ? "cancelled" : "error",
    permissions: settlePendingPermissions(turn.permissions, isTimeout ? "timeout" : "denied"),
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
): SessionUiState {
  return {
    ...state,
    started: false,
    ended: true,
    endedReason: reason,
    activeTurnId: null,
    turns: state.turns.map((turn) =>
      turn.status === "streaming" || turn.status === "waiting"
        ? {
            ...turn,
            status: reason === "error" ? "error" : reason === "stopped" ? "cancelled" : "done",
            permissions: settlePendingPermissions(turn.permissions, "denied"),
          }
        : turn,
    ),
  }
}

function applyFailure(state: SessionUiState, message: string, code?: string): SessionUiState {
  const error = sessionErrorView(code === undefined ? message : `${code}: ${message}`)
  const next = updateActiveTurn(state, (turn) => ({
    ...turn,
    status: "error",
    permissions: settlePendingPermissions(turn.permissions, "denied"),
    errors: [...turn.errors, error],
  }))
  return { ...next, error }
}

function answerPermission(
  state: SessionUiState,
  requestId: string,
  decision: "allow" | "deny",
): SessionUiState {
  return {
    ...state,
    turns: state.turns.map((turn) => {
      if (!turn.permissions.some((card) => card.requestId === requestId)) return turn
      const permissions = turn.permissions.map((card) =>
        card.requestId === requestId
          ? { ...card, status: decision === "allow" ? ("allowed" as const) : ("denied" as const) }
          : card,
      )
      const pending = permissions.some((card) => card.status === "pending")
      return {
        ...turn,
        permissions,
        status: pending || turn.status !== "waiting" ? turn.status : "streaming",
      }
    }),
  }
}

function settlePendingPermissions(
  cards: SessionPermissionCard[],
  status: "denied" | "timeout",
): SessionPermissionCard[] {
  return cards.map((card) => (card.status === "pending" ? { ...card, status } : card))
}

function readMode(value: string): SessionPermissionMode {
  if (
    value === "default" ||
    value === "acceptEdits" ||
    value === "plan" ||
    value === "bypassPermissions"
  ) {
    return value
  }
  return "default"
}
