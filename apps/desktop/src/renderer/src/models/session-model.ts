// 负责聊天界面的会话状态：会话是否在运行、权限模式、模型和账号、哪一轮开着、用户发过的消息和
// 对权限卡片的回答、界面先行结束的一轮、错误和提示，并把主进程错误码映射成中文文案。
// 收到的信封交给按会话 id 组织的事件存储，开始新会话时别的会话的信封仍留在存储里；
// 只有当前会话的信封改变界面状态。时间线的内容（文字、思考、工具、权限、换号）不在这里归并，
// 由 session-timeline 从信封投影。一轮由主进程开闭：turn-ended 才结束这一轮，result 只留在信封里。
// 每个动作都带 ISO UTC 时间：事件取信封时间，界面操作取操作时的时间。

import type { SessionEnvelope } from "../../../main/session/session-envelope"
import { timelineNotice } from "../../../main/session/session-notice"
import type {
  SessionHostEvent,
  SessionPermissionMode,
  SessionTurnEndStatus,
} from "../../../main/session/session-types"
import { sessionErrorView, type SessionErrorView } from "./session-errors"
import {
  lastSeq,
  sessionRecord,
  storeEnvelope,
  type SessionEventStore,
} from "./session-event-store"
import type { SessionPermissionAnswers } from "./session-permissions"

export { sessionErrorText, sessionErrorView } from "./session-errors"

/** 界面展示的错误；warning 表示不终止会话的提示。 */
export type { SessionErrorView } from "./session-errors"

/** 一轮对话的展示状态；等待审批由时间线按没回答的权限卡片判断。 */
export type SessionTurnStatus = "streaming" | "done" | "error" | "cancelled"

/**
 * 界面上的一轮：用户发出的一条消息，或主进程自己开的一轮。mainTurnId 是主进程的回合 id，
 * turn-started 到达后才有；afterSeq 是这一轮开始时已经收到的最大序号，只有更晚的事件才可能属于它。
 * 结束前 endedAt 为 null；endCode 是结束这一轮的错误码。
 */
export type SessionTurn = {
  id: string
  mainTurnId: string | null
  afterSeq: number
  userText: string | null
  startedAt: string
  endedAt: string | null
  status: SessionTurnStatus
  endCode: string | null
  errors: SessionErrorView[]
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
  /** 用户对权限卡片的回答，按请求 id；界面立即按回答显示，不等主进程。 */
  answers: SessionPermissionAnswers
  /** 收到的信封，按会话 id。 */
  events: SessionEventStore
  error: SessionErrorView | null
  notice: SessionNotice | null
}

/** 会话状态机动作；信封整条交进来，界面操作的 at 取操作时间。 */
export type SessionAction =
  | { type: "starting" }
  | { type: "opened"; sessionId: string }
  | { type: "user-message"; text: string; turnId: string; at: string }
  | { type: "envelope"; envelope: SessionEnvelope }
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
    answers: {},
    events: {},
    error: null,
    notice: null,
  }
}

/** 归并一个动作；保证同一序号的信封只生效一次，同一张权限卡片只记第一次回答。 */
export function reduceSession(state: SessionUiState, action: SessionAction): SessionUiState {
  switch (action.type) {
    case "starting":
      return { ...createSessionState(), events: state.events }
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
      return appendTurn(state, action.turnId, action.text, action.at, currentSeq(state))
    case "envelope":
      return applyEnvelope(state, action.envelope)
    case "permission-answered":
      if (state.answers[action.requestId] !== undefined) return state
      return {
        ...state,
        answers: {
          ...state.answers,
          [action.requestId]: { decision: action.decision, at: action.at },
        },
      }
    case "cancel-requested":
      // 没有活动 turn 时取消只是空操作，不能凭空造一条已取消的对话。
      if (state.activeTurnId === null) return { ...state, error: null }
      return updateActiveTurn({ ...state, error: null }, action.at, (turn) =>
        endTurn(turn, "cancelled", null, action.at),
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
          turn.status === "streaming" ? endTurn(turn, "cancelled", null, action.at) : turn,
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

function currentSeq(state: SessionUiState): number {
  return lastSeq(sessionRecord(state.events, state.sessionId))
}

// 还不知道当前会话时（例如刷新后），跟随信封所属的会话。
// 开始新会话之前已经收到过信封的会话不跟随，上一个会话迟到的信封不会被认成新会话的。
function applyEnvelope(state: SessionUiState, envelope: SessionEnvelope): SessionUiState {
  const { sessionId, seq } = envelope
  const seen = sessionId !== null && state.events[sessionId] !== undefined
  const events = storeEnvelope(state.events, envelope)
  if (events === state.events && sessionId !== null && seq !== null) return state
  const current = state.sessionId ?? (seen ? null : sessionId)
  if (sessionId !== null && sessionId !== current) return { ...state, events }
  return applyEvent({ ...state, events, sessionId: current }, envelope)
}

// 一条信封之前已经收到的最大序号；只用于实时的信封按 0 算。
function seqBefore(envelope: SessionEnvelope): number {
  return (envelope.seq ?? 1) - 1
}

function implicitTurnId(state: SessionUiState): string {
  return `turn-implicit-${state.turns.length + 1}`
}

function applyEvent(state: SessionUiState, envelope: SessionEnvelope): SessionUiState {
  const { event, at } = envelope
  switch (event.type) {
    case "started":
      return {
        ...state,
        sessionId: envelope.sessionId ?? state.sessionId ?? event.sessionId,
        started: true,
        ended: false,
        endedReason: null,
        model: event.model,
      }
    case "mode":
      return { ...state, permissionMode: readMode(event.permissionMode, state.permissionMode) }
    case "notice":
      return "message" in event && timelineNotice(event) === null
        ? { ...state, notice: { message: event.message } }
        : state
    case "message":
    case "tool-result":
    case "permission":
      // 时间线的内容由投影处理；还没有任何一轮时，事件自己开一轮，不让内容无处可放。
      if (state.turns.length > 0) return state
      return appendTurn(state, implicitTurnId(state), null, at, seqBefore(envelope))
    case "account-switched":
      return { ...state, accountId: event.to }
    case "turn-started":
      return applyTurnStarted(state, event.turnId, at, seqBefore(envelope))
    case "turn-ended":
      return applyTurnEnded(state, event.status, event.errorCode, at)
    case "error":
      return applyError(state, event, at)
    case "ended":
      return applyEnded(state, event.reason, at)
    default:
      return state
  }
}

function newTurn(id: string, userText: string | null, at: string, afterSeq: number): SessionTurn {
  return {
    id,
    mainTurnId: null,
    afterSeq,
    userText,
    startedAt: at,
    endedAt: null,
    status: "streaming",
    endCode: null,
    errors: [],
  }
}

function appendTurn(
  state: SessionUiState,
  turnId: string,
  userText: string | null,
  at: string,
  afterSeq: number,
): SessionUiState {
  return {
    ...state,
    turns: [...state.turns, newTurn(turnId, userText, at, afterSeq)],
    activeTurnId: turnId,
  }
}

// 主进程开了一轮：交给这个窗口刚发出、还没认领的那一轮；没有时（例如刷新后补拉到）另开一轮。
function applyTurnStarted(
  state: SessionUiState,
  mainTurnId: string,
  at: string,
  afterSeq: number,
): SessionUiState {
  if (state.turns.some((turn) => turn.mainTurnId === mainTurnId)) return state
  const active = state.turns.find((turn) => turn.id === state.activeTurnId)
  if (active === undefined) {
    const next = appendTurn(state, mainTurnId, null, at, afterSeq)
    return updateActiveTurn(next, at, (turn) => ({ ...turn, mainTurnId }))
  }
  if (active.mainTurnId !== null) return state
  return updateActiveTurn(state, at, (turn) => ({ ...turn, mainTurnId }))
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
  const implicitId = implicitTurnId(state)
  const afterSeq = currentSeq(state)
  const turn = update(newTurn(implicitId, null, at, afterSeq))
  return { ...state, turns: [...state.turns, turn], activeTurnId: implicitId }
}

function endTurn(
  turn: SessionTurn,
  status: "done" | "error" | "cancelled",
  code: string | null,
  at: string,
): SessionTurn {
  return { ...turn, status, endedAt: turn.endedAt ?? at, endCode: turn.endCode ?? code }
}

// 主进程结束这一轮：已经在界面上取消或出错的一轮保留原来的状态和结束时间。
function applyTurnEnded(
  state: SessionUiState,
  status: SessionTurnEndStatus,
  errorCode: string | null,
  at: string,
): SessionUiState {
  if (state.activeTurnId === null) return state
  const next = updateActiveTurn(state, at, (turn) => {
    if (turn.status !== "streaming") return turn
    const ended = status === "completed" ? "done" : status === "error" ? "error" : "cancelled"
    return endTurn(turn, ended, errorCode, at)
  })
  return { ...next, activeTurnId: null }
}

// 迟到事件优先落到最后一轮，避免在一轮结束之后凭空多出一轮没有提问的对话。
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

function applyError(
  state: SessionUiState,
  event: Extract<SessionHostEvent, { type: "error" }>,
  at: string,
): SessionUiState {
  const { code, message } = event
  const error = sessionErrorView(message.startsWith(code) ? message : `${code}: ${message}`)
  if (error.warning) {
    return updateLatestTurn(state, (turn) => ({ ...turn, errors: [...turn.errors, error] }))
  }
  const isCancelled = code === "SESSION_CANCELLED" || error.code === "SESSION_CANCELLED"
  // 没有活动 turn 的取消错误不生成 ghost turn，只保留会话级提示。
  if (isCancelled && state.activeTurnId === null) return { ...state, error: null }
  const next = updateActiveTurn(state, at, (turn) => ({
    ...endTurn(turn, isCancelled ? "cancelled" : "error", error.code, at),
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
      turn.status === "streaming" ? endTurn(turn, status, null, at) : turn,
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
    ...endTurn(turn, "error", error.code, at),
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
