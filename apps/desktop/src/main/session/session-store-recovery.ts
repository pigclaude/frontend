// 负责启动收敛的规则：应用上次退出时还在运行的会话，按时间线里有没有没结束的回合改为中断或停放；
// 中断的回合补一条「应用已重启」提示并用 turn-ended 闭合，没回答的提问补 question-resolved（空答案）。
// 权限请求没有单独的结算事件，随所在回合的 turn-ended（APP_RESTARTED）一起结算为已失效。
// 时间线已经以补写的 turn-ended（APP_RESTARTED）结尾时按中断处理，不再补写。

import { sessionEnvelopeVersion, type SessionEnvelope } from "./session-envelope"
import type { SessionLastTurn } from "./session-index"
import type { SessionHostEvent } from "./session-types"

/** 应用重启打断的回合在 turn-ended 和索引最后一轮里用的错误码。 */
export const appRestartedErrorCode = "APP_RESTARTED"

/** 一个运行中会话的收敛结果：新状态、要补写的信封（序号和时间已排好）；中断时还有最后一轮的新状态。 */
export type SessionRecovery =
  | { status: "parked"; envelopes: SessionEnvelope[] }
  | { status: "interrupted"; envelopes: SessionEnvelope[]; lastTurn: SessionLastTurn }

/**
 * 按时间线算出收敛结果。补写的信封序号接着时间线的最大序号，时间取 now 且不早于最后一条；
 * 收敛后每个 turn-started 恰好有一个 turn-ended，每个提问都有 question-resolved。
 */
export function recoverSession(
  sessionId: string,
  timeline: readonly SessionEnvelope[],
  now: number,
): SessionRecovery {
  const openTurns: string[] = []
  const openQuestions: string[] = []
  let lastSeq = 0
  let lastAt = now
  for (const { seq, at, event } of timeline) {
    lastSeq = Math.max(lastSeq, seq ?? 0)
    lastAt = Math.max(lastAt, Date.parse(at) || 0)
    if (event.type === "turn-started") openTurns.push(event.turnId)
    if (event.type === "turn-ended") remove(openTurns, event.turnId)
    if (event.type === "question") openQuestions.push(event.requestId)
    if (event.type === "question-resolved") remove(openQuestions, event.requestId)
  }
  const events: SessionHostEvent[] = openQuestions.map((requestId) => ({
    type: "question-resolved",
    requestId,
    answers: [],
  }))
  if (openTurns.length > 0) {
    events.push({ type: "notice", key: "host.restarted", level: "warning", params: {} })
  }
  for (const turnId of openTurns)
    events.push({
      type: "turn-ended",
      turnId,
      status: "interrupted",
      errorCode: appRestartedErrorCode,
    })
  const at = new Date(lastAt).toISOString()
  const envelopes = events.map((event, index): SessionEnvelope => ({
    version: sessionEnvelopeVersion,
    sessionId,
    seq: lastSeq + index + 1,
    at,
    event,
  }))
  if (openTurns.length === 0 && !endsWithRestart(timeline)) return { status: "parked", envelopes }
  return {
    status: "interrupted",
    envelopes,
    lastTurn: { status: "interrupted", errorCode: appRestartedErrorCode },
  }
}

/** 时间线停在一次收敛补写的回合闭合上：上次收敛写完时间线、但索引没写成。 */
function endsWithRestart(timeline: readonly SessionEnvelope[]): boolean {
  const last = timeline.at(-1)?.event
  return last?.type === "turn-ended" && last.errorCode === appRestartedErrorCode
}

function remove(items: string[], item: string): void {
  const index = items.indexOf(item)
  if (index >= 0) items.splice(index, 1)
}
