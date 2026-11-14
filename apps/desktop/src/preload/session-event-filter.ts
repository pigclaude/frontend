// 负责预加载脚本校验会话信封：只把格式版本、会话 id、序号、时间都合规，
// 且事件类型在会话宿主事件表里的信封交给渲染进程。

import {
  sessionEnvelopeVersion,
  sessionEventKinds,
  type SessionEnvelope,
} from "../main/session/session-envelope"

const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * 判断主进程发来的值是不是合规的会话信封。要保存的会话事件必须带正整数序号，只用于实时的事件
 * 和不属于任何会话的宿主事件不带序号；时间必须是 ISO UTC。
 */
export function isSessionEnvelope(value: unknown): value is SessionEnvelope {
  if (!isRecord(value) || value.version !== sessionEnvelopeVersion) return false
  const { sessionId, seq, at, event } = value
  if (sessionId !== null && (typeof sessionId !== "string" || sessionId === "")) return false
  if (typeof at !== "string" || !isoUtc.test(at) || !Number.isFinite(Date.parse(at))) return false
  if (!isRecord(event) || typeof event.type !== "string") return false
  if (!Object.hasOwn(sessionEventKinds, event.type)) return false
  if (event.type === "sessions-changed") {
    return sessionId === null && seq === null && isOptionalRemoval(event.removed)
  }
  const kind = sessionEventKinds[event.type as SessionEnvelope["event"]["type"]]
  if (sessionId === null || kind === "live") return seq === null
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0
}

function isOptionalRemoval(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.sessionId === "string" &&
      value.sessionId.length > 0 &&
      typeof value.projectPath === "string" &&
      value.projectPath.length > 0)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
