// 负责把一个会话的信封投影成 Pigcode 对话组件要的时间线事件：按回合分段后，消息里的思考、正文和工具调用、
// 工具结果、权限请求与回答、换号各自成为线程事件，事件时间取信封时间；一轮的开始和结束取界面状态。
// 进行中的一轮里，正在输出的正文和最后一段已落成消息的正文作为流式回答交给组件，这一轮结束后才落成回答，
// 显示的位置不变。纯函数，不读桌面桥。

import type { ThreadEvent } from "@pigclaude/ui-contracts"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { sessionErrorText } from "./session-errors"
import type { SessionEventRecord } from "./session-event-store"
import type { SessionTurn } from "./session-model"
import { permissionCards, type SessionPermissionAnswer } from "./session-permissions"
import { sessionRuns, type SessionRun } from "./session-runs"

/** 投影的输入：一个会话的信封和实时文字、界面上的各轮，以及用户对权限卡片的回答。 */
export type SessionTimelineInput = {
  threadId: string
  record: SessionEventRecord
  turns: readonly SessionTurn[]
  answers: Readonly<Record<string, SessionPermissionAnswer>>
}

/** 组件要的时间线：线程事件，进行中那一轮的流式回答和正在输出的思考，以及最后一轮的 run id。 */
export type SessionTimeline = {
  events: ThreadEvent[]
  streamingText: string
  liveReasoning: string
  lastRunId: string | null
}

type MessageEvent = Extract<SessionHostEvent, { type: "message" }>

/** 投影前的一条线程事件；序号在整条时间线拼好之后再编。 */
type Draft = { type: ThreadEvent["type"]; runId: string | null; payload: unknown; at: string }

/** 一轮投影出的事件；held 是留在流式回答位置、还没落成回答的那段正文。 */
type RunDrafts = { drafts: Draft[]; held: string | null }

/** 把信封投影成时间线；同样的输入总是得到同样的结果。 */
export function projectTimeline(input: SessionTimelineInput): SessionTimeline {
  const { threadId, record, turns, answers } = input
  const runs = sessionRuns(record.envelopes, turns)
  const openIndex = runs.findLastIndex((run) => run.turn.status === "streaming")
  const drafts: Draft[] = []
  let streamingText = ""
  for (const [index, run] of runs.entries()) {
    const open = index === openIndex
    const projected = projectRun(run, `run-${index + 1}`, answers, open && record.live.text === "")
    drafts.push(...projected.drafts)
    if (open) streamingText = record.live.text !== "" ? record.live.text : (projected.held ?? "")
  }
  return {
    events: drafts.map((draft, index) => ({
      seq: index + 1,
      threadId,
      runId: draft.runId,
      type: draft.type,
      payload: draft.payload,
      schemaVersion: 1,
      createdAt: draft.at,
    })),
    streamingText,
    liveReasoning: openIndex < 0 ? "" : record.live.reasoning,
    lastRunId: runs.length === 0 ? null : `run-${runs.length}`,
  }
}

function projectRun(
  run: SessionRun,
  runId: string,
  answers: Readonly<Record<string, SessionPermissionAnswer>>,
  hold: boolean,
): RunDrafts {
  const { turn } = run
  const drafts: Draft[] = []
  const push = (type: ThreadEvent["type"], payload: unknown, at: string): void => {
    drafts.push({ type, runId, payload, at })
  }
  const blocks = new Set<string>()
  const tools = new Map<string, string>()
  const finished = new Set<string>()
  const cards = new Map(permissionCards(run, answers).map((card) => [card.requestId, card]))
  let lastSwitch: string | null = null
  let held: number | null = null
  push(
    "run.started",
    { agentId: "claude", ...(turn.userText === null ? {} : { text: turn.userText }) },
    turn.startedAt,
  )
  for (const envelope of run.envelopes) {
    const { event, at } = envelope
    switch (event.type) {
      case "message":
        for (const block of event.blocks) {
          if (block.type === "tool-use") {
            if (tools.has(block.id)) continue
            tools.set(block.id, block.name)
            pushToolStart(push, block.id, block.name, block.input, at)
            held = null
            continue
          }
          const key = `${event.messageId}\u0000${block.type}\u0000${block.text}`
          if (block.text === "" || blocks.has(key)) continue
          blocks.add(key)
          if (block.type === "thinking") {
            push("reasoning.completed", reasoningPayload(block.text, event), at)
            held = null
          } else {
            push("message.completed", { text: block.text }, at)
            held = event.parentToolUseId === null ? drafts.length - 1 : null
          }
        }
        break
      case "tool-result": {
        if (finished.has(event.toolUseId)) break
        finished.add(event.toolUseId)
        let name = tools.get(event.toolUseId)
        if (name === undefined) {
          name = "工具结果"
          tools.set(event.toolUseId, name)
          pushToolStart(push, event.toolUseId, name, null, at)
        }
        pushToolEnd(push, event, name, at)
        held = null
        break
      }
      case "permission": {
        const card = cards.get(event.requestId)
        if (card === undefined) break
        cards.delete(event.requestId)
        const input = card.input
        push(
          "approval.requested",
          {
            id: card.requestId,
            toolName: card.toolName,
            title: card.toolName,
            ...(typeof input.command === "string" ? { command: input.command } : {}),
            ...(card.blockedPath === null ? {} : { description: card.blockedPath }),
            input,
          },
          card.requestedAt,
        )
        if (card.status === "pending") break
        push(
          "approval.resolved",
          { id: card.requestId, decision: card.status === "allowed" ? "allow-once" : "deny" },
          card.resolvedAt ?? card.requestedAt,
        )
        break
      }
      case "account-switched": {
        const key = `${event.from}>${event.to}>${event.reason}`
        if (event.reason === "initial" || key === lastSwitch) break
        lastSwitch = key
        drafts.push({ type: "thread.updated", runId: null, payload: { agentId: event.to }, at })
        break
      }
      default:
        break
    }
  }
  return endRun(turn, drafts, push, hold ? held : null)
}

function endRun(
  turn: SessionTurn,
  drafts: Draft[],
  push: (type: ThreadEvent["type"], payload: unknown, at: string) => void,
  held: number | null,
): RunDrafts {
  const endedAt = turn.endedAt ?? turn.startedAt
  switch (turn.status) {
    case "streaming": {
      if (held === null) return { drafts, held: null }
      const [answer] = drafts.splice(held, 1)
      const payload = answer?.payload as { text?: unknown } | undefined
      return { drafts, held: typeof payload?.text === "string" ? payload.text : null }
    }
    case "error": {
      const fallback = sessionErrorText(`${turn.endCode ?? "SDK_ERROR"}: 会话出错`)
      push("run.failed", { message: turn.errors.at(-1)?.message ?? fallback }, endedAt)
      break
    }
    case "cancelled":
      push("run.interrupted", {}, endedAt)
      break
    default:
      push("run.completed", {}, endedAt)
  }
  return { drafts, held: null }
}

function reasoningPayload(text: string, event: MessageEvent): Record<string, unknown> {
  return event.thinkingMs === undefined ? { text } : { text, durationMs: event.thinkingMs }
}

function isSubagentTool(name: string): boolean {
  return name === "Task" || name === "Agent"
}

function pushToolStart(
  push: (type: ThreadEvent["type"], payload: unknown, at: string) => void,
  id: string,
  name: string,
  input: unknown,
  at: string,
): void {
  if (!isSubagentTool(name)) {
    push("tool.started", { toolCallId: id, name, input }, at)
    return
  }
  const fields = (input ?? {}) as Record<string, unknown>
  push(
    "subagent.started",
    {
      toolCallId: id,
      name: typeof fields.subagent_type === "string" ? fields.subagent_type : "子代理",
      ...(typeof fields.description === "string" ? { description: fields.description } : {}),
      ...(typeof fields.prompt === "string" ? { prompt: fields.prompt } : {}),
    },
    at,
  )
}

function pushToolEnd(
  push: (type: ThreadEvent["type"], payload: unknown, at: string) => void,
  event: Extract<SessionHostEvent, { type: "tool-result" }>,
  name: string,
  at: string,
): void {
  const { toolUseId: toolCallId, content: output, isError } = event
  if (isSubagentTool(name)) {
    const status = isError ? "failed" : "completed"
    push("subagent.completed", { toolCallId, output, isError, status }, at)
  } else {
    push("tool.completed", { toolCallId, name, output, isError }, at)
  }
}
