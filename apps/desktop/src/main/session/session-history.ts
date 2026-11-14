// 负责回放磁盘上已有的会话信封，补齐早期事件的子代理归属，兼容新旧时间线。

import { sessionEventKinds, type SessionEnvelope } from "./session-envelope"
import { subagentRef } from "./subagent-tasks"

/** 补齐旧事件的归属、跳过本版本无法回放的事件，保留可回放信封的序号、时间及附加字段。 */
export function normalizeHistory<T extends SessionEnvelope>(
  envelopes: readonly T[],
): Array<Omit<T, "event"> & Pick<SessionEnvelope, "event">> {
  return envelopes.flatMap((envelope) => {
    const { event } = envelope
    if (
      !Object.hasOwn(sessionEventKinds, event.type) ||
      sessionEventKinds[event.type] !== "persisted" ||
      !validHistoryTime(envelope.at)
    ) {
      return []
    }
    return [{ ...envelope, event: normalizeOwner(event) }]
  })
}

function validHistoryTime(at: string): boolean {
  const time = Date.parse(at)
  return Number.isFinite(time) && at.length === 24 && new Date(time).toISOString() === at
}

function normalizeOwner(event: SessionEnvelope["event"]): SessionEnvelope["event"] {
  if (
    (event.type !== "message" && event.type !== "tool-result" && event.type !== "permission") ||
    Object.hasOwn(event, "subagent")
  ) {
    return event
  }
  const parentToolUseId =
    "parentToolUseId" in event && typeof event.parentToolUseId === "string"
      ? event.parentToolUseId
      : null
  return { ...event, subagent: subagentRef(parentToolUseId, null) }
}
