// 校验磁盘信封能否回放，跳过损坏的新旧事件并补齐早期事件的子代理归属。

import { sessionEventKinds, type SessionEnvelope } from "./session-envelope"
import { isPlainRecord } from "./session-store-guards"
import { subagentRef } from "./subagent-tasks"

type HistoryEvent = SessionEnvelope["event"]

/** 补齐旧事件的归属、跳过本版本无法回放的事件，保留可回放信封的序号、时间及附加字段。 */
export function normalizeHistory<T extends SessionEnvelope>(
  envelopes: readonly T[],
): Array<Omit<T, "event"> & Pick<SessionEnvelope, "event">> {
  return envelopes.flatMap((envelope) => {
    const { event } = envelope
    if (
      !Object.hasOwn(sessionEventKinds, event.type) ||
      sessionEventKinds[event.type] !== "persisted" ||
      !validHistoryTime(envelope.at) ||
      !canReplay(event)
    ) {
      return []
    }
    return [{ ...envelope, event: normalizeOwner(event) }]
  })
}

// 这里只校验重放必需的字段；额外字段、可选元数据及 SDK 的工具输入原样保留。
function canReplay(event: HistoryEvent): boolean {
  switch (event.type) {
    case "started":
      return (
        strings(event.sessionId, event.model, event.permissionMode) && isStringArray(event.tools)
      )
    case "mode":
      return typeof event.permissionMode === "string"
    case "message":
      return (
        typeof event.messageId === "string" &&
        Array.isArray(event.blocks) &&
        event.blocks.every(canReplayBlock)
      )
    case "tool-result":
      return strings(event.toolUseId, event.content) && typeof event.isError === "boolean"
    case "permission":
      return strings(event.requestId, event.toolName) && isPlainRecord(event.input)
    case "question":
      return typeof event.requestId === "string" && Array.isArray(event.questions)
    case "question-resolved":
      return typeof event.requestId === "string" && isStringArray(event.answers)
    case "account-switched":
      return (
        strings(event.to, event.reason) && (event.from === null || typeof event.from === "string")
      )
    case "notice":
      return "message" in event ? typeof event.message === "string" : typeof event.key === "string"
    case "context":
      return (
        typeof event.usedTokens === "number" &&
        nullableNumber(event.maxTokens) &&
        nullableNumber(event.autoCompactTokens)
      )
    case "turn-started":
      return typeof event.turnId === "string"
    case "turn-ended":
      return (
        typeof event.turnId === "string" &&
        (event.status === "completed" || event.status === "error" || event.status === "interrupted")
      )
    case "subagent-ended":
      return strings(event.parentToolUseId, event.summary, event.status)
    case "workflow":
      return canReplayWorkflow(event.workflow)
    case "error":
      return strings(event.code, event.message)
    case "ended":
      return event.reason === "completed" || event.reason === "stopped" || event.reason === "error"
    case "result":
      // 时间线只识别 result 的边界，较早记录可以没有用量。
      return true
    case "delta":
    case "sessions-changed":
      return false
  }
}

function canReplayBlock(block: unknown): boolean {
  if (!isPlainRecord(block)) return false
  if (block.type === "tool-use") return strings(block.id, block.name)
  return (block.type === "text" || block.type === "thinking") && typeof block.text === "string"
}

function canReplayWorkflow(workflow: unknown): boolean {
  if (!isPlainRecord(workflow) || typeof workflow.toolCallId !== "string") return false
  const { phases, agents } = workflow
  // 快照可省略阶段和 agent，卡片此时保留上一次的值。
  return (
    (phases === undefined || (Array.isArray(phases) && phases.every(canReplayPhase))) &&
    (agents === undefined || (Array.isArray(agents) && agents.every(canReplayAgent))) &&
    [workflow.name, workflow.description, workflow.script, workflow.summary].every(optionalString)
  )
}

function canReplayPhase(value: unknown): boolean {
  return isPlainRecord(value) && typeof value.title === "string"
}

function canReplayAgent(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    typeof value.index === "number" &&
    strings(value.label, value.state) &&
    [value.phase, value.activity, value.prompt, value.result].every(optionalString)
  )
}

function nullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number"
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string"
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function strings(...values: unknown[]): boolean {
  return values.every((value) => typeof value === "string")
}

function validHistoryTime(at: string): boolean {
  const time = Date.parse(at)
  return Number.isFinite(time) && at.length === 24 && new Date(time).toISOString() === at
}

function normalizeOwner(event: SessionEnvelope["event"]): SessionEnvelope["event"] {
  if (event.type !== "message" && event.type !== "tool-result" && event.type !== "permission") {
    return event
  }
  const owner: unknown = event.subagent
  if (owner === null || isPlainRecord(owner)) {
    return event
  }
  const parentToolUseId =
    "parentToolUseId" in event && typeof event.parentToolUseId === "string"
      ? event.parentToolUseId
      : null
  return { ...event, subagent: subagentRef(parentToolUseId, null) }
}
