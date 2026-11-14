// 按会话 id 组织渲染层状态，每份状态继续使用同一个会话归约器。

import {
  createSessionState,
  reduceSession,
  type SessionAction,
  type SessionUiState,
} from "./session-model"
import type { SessionEnvelope } from "../../../main/session/session-envelope"

/** 每个会话独立保存回合、信封和审批，空键处理没有会话的界面操作。 */
export type SessionCollection = ReadonlyMap<string | null, SessionUiState>

/** 一个操作只改变其目标会话的状态。 */
export type SessionCollectionAction = { sessionId: string | null; action: SessionAction }

const empty = createSessionState()

/** 选择已有的会话状态，新会话还没有事件时返回空状态。 */
export function sessionState(states: SessionCollection, sessionId: string | null): SessionUiState {
  return states.get(sessionId) ?? (sessionId === null ? empty : { ...empty, sessionId })
}

/** 只归约事件或命令所指向的会话，其他会话保留原来对象。 */
export function reduceSessionCollection(
  states: SessionCollection,
  { sessionId, action }: SessionCollectionAction,
): SessionCollection {
  const current = sessionState(states, sessionId)
  const next = reduceSession(current, action)
  if (next === current) return states
  return new Map(states).set(sessionId, next)
}

/** 会话列表会在这些事件后变化；文字流和高频工作流进度无需查询。 */
export function refreshesSessionList({ event }: SessionEnvelope): boolean {
  switch (event.type) {
    case "sessions-changed":
    case "started":
    case "account-switched":
    case "turn-started":
    case "turn-ended":
    case "permission":
    case "question":
    case "question-resolved":
      return true
    default:
      return false
  }
}
