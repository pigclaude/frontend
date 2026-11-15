// 负责一轮对话里的权限卡片：从权限请求的信封得出卡片，按用户的回答结算；这一轮结束时没回答的卡片
// 按拒绝结算，权限询问超时结束的一轮按超时结算。卡片带请求和结算的时间，以及发起它的子代理。

import type { SessionEnvelope } from "../../../main/session/session-envelope"
import type { SubagentRef } from "../../../main/session/session-events"
import type { CapabilityPluginPermissionSource } from "../../../capability-plugin-contract"
import {
  isPermissionSuggestionView,
  type PermissionSuggestionView,
} from "../../../project-permissions-contract"
import { sessionRecord } from "./session-event-store"
import type { SessionUiState } from "./session-model"
import { sessionRuns, type SessionRun } from "./session-runs"

/** 权限卡片的结算状态。 */
export type SessionPermissionStatus = "pending" | "allowed" | "denied" | "timeout"

/** 用户对一张权限卡片的回答；at 是回答时的时间。 */
export type SessionPermissionAnswer = { decision: "allow" | "deny"; at: string }

/** 用户对权限卡片的回答，按请求 id；每个请求只记第一次回答。 */
export type SessionPermissionAnswers = Readonly<Record<string, SessionPermissionAnswer>>

/** 一张需要回答或已经回答的权限卡片；时间是 ISO UTC。 */
export type SessionPermissionCard = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  suggestions: PermissionSuggestionView[]
  /** 需要额外确认时，卡片默认选择拒绝并停用数字键。 */
  defaultToNo?: boolean
  blockedPath: string | null
  /** 已登记能力插件的来源，来自主进程的权限事件。 */
  plugin?: CapabilityPluginPermissionSource
  /** 发起请求的子代理；主线程为 null。 */
  subagent: SubagentRef | null
  status: SessionPermissionStatus
  requestedAt: string
  resolvedAt: string | null
}

/** 一轮里的权限卡片，按请求的先后，同一请求只有一张。 */
export function permissionCards(
  run: SessionRun,
  answers: SessionPermissionAnswers,
): SessionPermissionCard[] {
  const cards: SessionPermissionCard[] = []
  for (const envelope of run.envelopes) {
    const card = cardOf(envelope, run, answers)
    if (card !== null && !cards.some((item) => item.requestId === card.requestId)) cards.push(card)
  }
  return cards
}

type PermissionState = Pick<SessionUiState, "events" | "sessionId" | "turns" | "answers">

/** 当前会话最早一张还没回答的权限卡片；没有时返回 null。 */
export function pendingPermission(state: PermissionState): SessionPermissionCard | null {
  return pendingCards(state)[0] ?? null
}

/**
 * 正在等权限回答的子代理。parents 是认得出的子代理（派生它们的 Agent 工具调用 id）；
 * unplaced 为真时，还有子代理发起的请求认不出是哪一个子代理的。
 */
export type WaitingSubagents = { parents: ReadonlySet<string>; unplaced: boolean }

/**
 * 当前会话里正在等权限回答的子代理。请求只带 agent id 时，按这个会话里子代理自己的消息和工具结果
 * 找回派生它的工具调用；还是找不到的记为 unplaced。主线程的请求不算。
 */
export function waitingSubagents(state: PermissionState): WaitingSubagents {
  const { envelopes } = sessionRecord(state.events, state.sessionId)
  const known = new Map<string, string>()
  for (const { event } of envelopes) {
    if (event.type !== "message" && event.type !== "tool-result") continue
    const ref = event.subagent
    if (ref?.parentToolUseId != null && ref.agentId !== null) {
      known.set(ref.agentId, ref.parentToolUseId)
    }
  }
  const parents = new Set<string>()
  let unplaced = false
  for (const { subagent } of pendingCards(state)) {
    if (subagent === null) continue
    const parent = subagent.parentToolUseId ?? known.get(subagent.agentId)
    if (parent === undefined) unplaced = true
    else parents.add(parent)
  }
  return { parents, unplaced }
}

function pendingCards(state: PermissionState): SessionPermissionCard[] {
  const record = sessionRecord(state.events, state.sessionId)
  return sessionRuns(record.envelopes, state.turns).flatMap((run) =>
    permissionCards(run, state.answers).filter((card) => card.status === "pending"),
  )
}

function cardOf(
  envelope: SessionEnvelope,
  run: SessionRun,
  answers: SessionPermissionAnswers,
): SessionPermissionCard | null {
  const { event, at } = envelope
  if (event.type !== "permission") return null
  const request = {
    requestId: event.requestId,
    toolName: event.toolName,
    input: event.input,
    suggestions: (event.suggestions ?? []).filter(isPermissionSuggestionView),
    ...(event.defaultToNo ? { defaultToNo: true } : {}),
    blockedPath: event.blockedPath ?? null,
    ...(event.plugin === undefined ? {} : { plugin: event.plugin }),
    subagent: event.subagent,
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
