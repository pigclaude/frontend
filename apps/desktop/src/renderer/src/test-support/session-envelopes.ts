// 负责测试里构造会话信封：按到达顺序给要保存的事件编序号，交给会话模型归并，
// 让模型、投影和聊天页的测试都从和主进程一样的信封出发。

import { sessionEventKinds, type SessionEnvelope } from "../../../main/session/session-envelope"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { lastSeq, sessionRecord } from "../models/session-event-store"
import { reduceSession, type SessionUiState } from "../models/session-model"

/** 测试里会话事件和界面操作默认共用的时间。 */
export const envelopeTime = "2026-11-14T01:00:00.000Z"

/** 给当前会话的下一条事件套上信封：要保存的事件接着已收到的最大序号编号，实时事件不编号。 */
export function nextEnvelope(
  state: SessionUiState,
  event: SessionHostEvent,
  at = envelopeTime,
): SessionEnvelope {
  const sessionId = state.sessionId ?? "session-1"
  const persisted = sessionEventKinds[event.type] === "persisted"
  const seq = persisted ? lastSeq(sessionRecord(state.events, sessionId)) + 1 : null
  return { version: 1, sessionId, seq, at, event }
}

/** 把一条事件当作主进程发来的信封交给会话模型。 */
export function receive(
  state: SessionUiState,
  event: SessionHostEvent,
  at = envelopeTime,
): SessionUiState {
  return reduceSession(state, { type: "envelope", envelope: nextEnvelope(state, event, at) })
}
