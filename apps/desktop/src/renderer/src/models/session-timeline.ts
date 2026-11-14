// 负责把一个会话的信封投影成 Pigcode 对话组件要的时间线事件：按回合分段后，消息里的思考、正文、
// 工具调用、工具结果、权限请求与回答、提问与回答、换号、工作流快照各自成为线程事件，事件时间取
// 信封时间；一轮的开始和结束取界面状态。子代理的消息和工具调用带上父工具调用 id，只进它的子代理卡；
// 有快照的 Workflow 工具调用由工作流卡代替。
// 进行中的一轮里，正在输出的正文和最后一段已落成消息的正文作为流式回答交给组件，这一轮结束后才
// 落成回答，显示的位置不变。界面先行结束、主进程还没发来 turn-ended 的一轮，正在输出的正文先落在
// 回答的位置，主进程补发的消息落在同一处。纯函数，不读桌面桥。

import type { ThreadEvent } from "@pigclaude/ui-contracts"
import { timelineNotice } from "../../../main/session/session-notice"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { latestSessionContext } from "./session-context-usage"
import { sessionErrorText } from "./session-errors"
import type { SessionEventRecord } from "./session-event-store"
import type { SessionTurn } from "./session-model"
import { permissionCards, type SessionPermissionAnswers } from "./session-permissions"
import { sessionRuns, type SessionRun } from "./session-runs"
import { SubagentCards, type PushDraft } from "./session-timeline-subagents"

/** 投影的输入：一个会话的信封和实时文字、界面上的各轮，以及用户对权限卡片的回答。 */
export type SessionTimelineInput = {
  threadId: string
  record: SessionEventRecord
  turns: readonly SessionTurn[]
  answers: SessionPermissionAnswers
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

/** 一轮里最后一段主线程正文：它在 drafts 里的下标和正文。 */
type LastAnswer = { index: number; text: string }

/**
 * 一轮的尾巴怎么处理：holdAnswer 为真时最后一段主线程正文留在流式回答的位置；
 * unlanded 是界面先行结束后还没落成消息的正文，补在这一轮结束之前。
 */
type RunTail = { holdAnswer: boolean; unlanded: string }

/** 一轮投影出的事件；heldText 是留在流式回答位置、还没落成回答的那段正文。 */
type RunDrafts = { drafts: Draft[]; heldText: string | null }

/** 把信封投影成时间线；同样的输入总是得到同样的结果。 */
export function projectTimeline(input: SessionTimelineInput): SessionTimeline {
  const { threadId, record, turns, answers } = input
  const runs = sessionRuns(record.envelopes, turns)
  const openIndex = runs.findLastIndex((run) => run.turn.status === "streaming")
  const live = record.live.text
  const drafts: Draft[] = []
  let streamingText = ""
  for (const [index, run] of runs.entries()) {
    const open = index === openIndex
    const awaitingEnd = openIndex < 0 && index === runs.length - 1 && !run.closed
    const tail = { holdAnswer: open && live === "", unlanded: awaitingEnd ? live : "" }
    const projected = projectRun(run, `run-${index + 1}`, answers, tail)
    drafts.push(...projected.drafts)
    if (open) streamingText = live !== "" ? live : (projected.heldText ?? "")
  }
  // 组件取最后一条 context.updated，换号的 thread.updated 会清空圆环，所以占用要排在全部事件之后。
  const context = latestSessionContext(record.envelopes)
  if (context !== null) {
    drafts.push({ type: "context.updated", runId: null, payload: context.usage, at: context.at })
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
  answers: SessionPermissionAnswers,
  tail: RunTail,
): RunDrafts {
  const { turn } = run
  const drafts: Draft[] = []
  const push: PushDraft = (type, payload, at) => {
    drafts.push({ type, runId, payload, at })
  }
  const blocks = new Set<string>()
  const tools = new Map<string, string>()
  const finished = new Set<string>()
  const subagents = new SubagentCards(push)
  const cards = new Map(permissionCards(run, answers).map((card) => [card.requestId, card]))
  const workflows = new Set(
    run.envelopes.flatMap(({ event }) =>
      event.type === "workflow" ? [event.workflow.toolCallId] : [],
    ),
  )
  let lastSwitch: string | null = null
  let lastAnswer: LastAnswer | null = null
  const referenced = turn.userText !== null && run.references.length > 0
  push(
    "run.started",
    {
      agentId: "claude",
      ...(turn.userText === null || referenced ? {} : { text: turn.userText }),
    },
    turn.startedAt,
  )
  if (referenced) {
    // Pigcode 从完整的用户消息事件读取会话标签。
    push(
      "message.completed",
      { role: "user", text: turn.userText, references: run.references },
      turn.startedAt,
    )
  }
  for (const envelope of run.envelopes) {
    const { event, at } = envelope
    switch (event.type) {
      case "message":
        if (event.subagent !== null) {
          subagents.owned(event, at)
          break
        }
        for (const block of event.blocks) {
          if (block.type === "tool-use") {
            if (tools.has(block.id)) continue
            tools.set(block.id, block.name)
            lastAnswer = null
            if (workflows.has(block.id)) continue
            if (!subagents.start(block.id, block.name, block.input, at)) {
              push(
                "tool.started",
                { toolCallId: block.id, name: block.name, input: block.input },
                at,
              )
            }
            continue
          }
          const key = `${event.messageId}\u0000${block.type}\u0000${block.text}`
          if (block.text === "" || blocks.has(key)) continue
          blocks.add(key)
          if (block.type === "thinking") {
            push("reasoning.completed", reasoningPayload(block.text, event), at)
            lastAnswer = null
          } else {
            push("message.completed", { text: block.text }, at)
            lastAnswer = { index: drafts.length - 1, text: block.text }
          }
        }
        break
      case "tool-result": {
        if (event.subagent !== null) {
          subagents.owned(event, at)
          break
        }
        if (finished.has(event.toolUseId)) break
        finished.add(event.toolUseId)
        lastAnswer = null
        if (subagents.toolResult(event, at)) break
        if (workflows.has(event.toolUseId)) break
        let name = tools.get(event.toolUseId)
        if (name === undefined) {
          name = "工具结果"
          tools.set(event.toolUseId, name)
          push("tool.started", { toolCallId: event.toolUseId, name, input: null }, at)
        }
        const { toolUseId: toolCallId, content: output, isError } = event
        push("tool.completed", { toolCallId, name, output, isError }, at)
        break
      }
      case "subagent-ended":
        subagents.ended(event, at)
        break
      case "workflow":
        push("workflow.updated", event.workflow, at)
        break
      case "notice": {
        const notice = timelineNotice(event)
        if (notice !== null) {
          const { key, level, params } = notice
          push("notice", { key, level, params }, at)
        }
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
      case "question":
        push("question.requested", { id: event.requestId, questions: event.questions }, at)
        lastAnswer = null
        break
      case "question-resolved":
        push("question.answered", { id: event.requestId, answers: event.answers }, at)
        break
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
  if (turn.status !== "streaming") subagents.settle(turn.endedAt ?? turn.startedAt)
  return endRun(turn, drafts, push, lastAnswer, tail)
}

function endRun(
  turn: SessionTurn,
  drafts: Draft[],
  push: PushDraft,
  lastAnswer: LastAnswer | null,
  tail: RunTail,
): RunDrafts {
  const endedAt = turn.endedAt ?? turn.startedAt
  if (turn.status === "streaming") {
    if (!tail.holdAnswer || lastAnswer === null) return { drafts, heldText: null }
    drafts.splice(lastAnswer.index, 1)
    return { drafts, heldText: lastAnswer.text }
  }
  if (tail.unlanded !== "") push("message.completed", { text: tail.unlanded }, endedAt)
  switch (turn.status) {
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
  return { drafts, heldText: null }
}

function reasoningPayload(text: string, event: MessageEvent): Record<string, unknown> {
  return event.thinkingMs === undefined ? { text } : { text, durationMs: event.thinkingMs }
}
