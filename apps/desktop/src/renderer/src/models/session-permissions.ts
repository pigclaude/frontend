// 负责一轮对话里的权限卡片：从权限请求的信封得出卡片，按用户的回答结算；这一轮结束时没回答的卡片
// 按拒绝结算，权限询问超时结束的一轮按超时结算。卡片带请求和结算的时间。

import type { SessionEnvelope } from "../../../main/session/session-envelope"
import { sessionRecord } from "./session-event-store"
import type { SessionUiState } from "./session-model"
import { sessionRuns, type SessionRun } from "./session-runs"

/** 权限卡片的结算状态。 */
export type SessionPermissionStatus = "pending" | "allowed" | "denied" | "timeout"

/** 用户对一张权限卡片的回答；at 是回答时的时间。 */
export type SessionPermissionAnswer = { decision: "allow" | "deny"; at: string }

/** 一张需要回答或已经回答的权限卡片；时间是 ISO UTC。 */
export type SessionPermissionCard = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  suggestions: unknown[]
  blockedPath: string | null
  status: SessionPermissionStatus
  requestedAt: string
  resolvedAt: string | null
}

/** 一轮里的权限卡片，按请求的先后，同一请求只有一张。 */
export function permissionCards(
  run: SessionRun,
  answers: Readonly<Record<string, SessionPermissionAnswer>>,
): SessionPermissionCard[] {
  const cards: SessionPermissionCard[] = []
  for (const envelope of run.envelopes) {
    const card = cardOf(envelope, run, answers)
    if (card !== null && !cards.some((item) => item.requestId === card.requestId)) cards.push(card)
  }
  return cards
}

/** 当前会话最早一张还没回答的权限卡片；没有时返回 null。 */
export function pendingPermission(
  state: Pick<SessionUiState, "events" | "sessionId" | "turns" | "answers">,
): SessionPermissionCard | null {
  const record = sessionRecord(state.events, state.sessionId)
  for (const run of sessionRuns(record.envelopes, state.turns)) {
    const pending = permissionCards(run, state.answers).find((card) => card.status === "pending")
    if (pending !== undefined) return pending
  }
  return null
}

function cardOf(
  envelope: SessionEnvelope,
  run: SessionRun,
  answers: Readonly<Record<string, SessionPermissionAnswer>>,
): SessionPermissionCard | null {
  const { event, at } = envelope
  if (event.type !== "permission") return null
  const request = {
    requestId: event.requestId,
    toolName: event.toolName,
    input: event.input,
    suggestions: event.suggestions ?? [],
    blockedPath: event.blockedPath ?? null,
    requestedAt: at,
  }
  const answer = answers[event.requestId]
  if (answer !== undefined) {
    const status = answer.decision === "allow" ? "allowed" : "denied"
    return { ...request, status, resolvedAt: answer.at }
  }
  const { turn } = run
  if (turn.status === "streaming") return { ...request, status: "pending", resolvedAt: null }
  const status = turn.endCode === "PERMISSION_TIMEOUT" ? "timeout" : "denied"
  return { ...request, status, resolvedAt: turn.endedAt ?? at }
}
