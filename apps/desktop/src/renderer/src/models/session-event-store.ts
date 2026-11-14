// 负责渲染层按会话 id 保存会话信封：要保存的事件按序号去重、按序号排列；正文和思考的实时增量单独缓冲，
// 主线程的正文或思考落成消息、调用工具、一轮开始或结束、会话结束时清掉对应的缓冲。不属于任何会话的事件不保存。

import type { SessionEnvelope } from "../../../main/session/session-envelope"
import type { SessionHostEvent } from "../../../main/session/session-types"

/** 正在输出、还没落成消息的正文和思考；只来自主线程的实时增量。 */
export type SessionLiveText = { text: string; reasoning: string }

/** 一个会话收到的事件：要保存的信封按序号排列、每个序号一条；实时增量只进缓冲。 */
export type SessionEventRecord = {
  envelopes: readonly SessionEnvelope[]
  live: SessionLiveText
}

/** 按会话 id 组织的事件存储；没有变化时保持同一个对象，界面可以据此跳过重算。 */
export type SessionEventStore = Readonly<Record<string, SessionEventRecord>>

const noLiveText: SessionLiveText = { text: "", reasoning: "" }
const emptyRecord: SessionEventRecord = { envelopes: [], live: noLiveText }

/** 取一个会话的事件；还没收到过这个会话的事件时返回空记录。 */
export function sessionRecord(
  store: SessionEventStore,
  sessionId: string | null,
): SessionEventRecord {
  return (sessionId === null ? undefined : store[sessionId]) ?? emptyRecord
}

/** 这个会话已收到的最大序号；还没有时为 0。 */
export function lastSeq(record: SessionEventRecord): number {
  return record.envelopes.at(-1)?.seq ?? 0
}

/** 收下一条信封。重复的序号和不属于任何会话的事件返回原来的存储。 */
export function storeEnvelope(
  store: SessionEventStore,
  envelope: SessionEnvelope,
): SessionEventStore {
  const { sessionId, seq, event } = envelope
  if (sessionId === null) return store
  const record = sessionRecord(store, sessionId)
  if (seq === null) {
    if (event.type !== "delta" || event.text === "") return store
    const live = event.thinking
      ? { ...record.live, reasoning: record.live.reasoning + event.text }
      : { ...record.live, text: record.live.text + event.text }
    return { ...store, [sessionId]: { ...record, live } }
  }
  let envelopes: SessionEnvelope[]
  if (seq > lastSeq(record)) {
    envelopes = [...record.envelopes, envelope]
  } else {
    if (record.envelopes.some((kept) => kept.seq === seq)) return store
    envelopes = [...record.envelopes, envelope].sort(
      (left, right) => (left.seq ?? 0) - (right.seq ?? 0),
    )
  }
  return { ...store, [sessionId]: { envelopes, live: liveAfter(record.live, event) } }
}

function liveAfter(live: SessionLiveText, event: SessionHostEvent): SessionLiveText {
  switch (event.type) {
    case "turn-started":
    case "turn-ended":
    case "ended":
      return noLiveText
    case "message": {
      if (event.parentToolUseId !== null) return live
      const kinds = new Set(event.blocks.map((block) => block.type))
      const text = kinds.has("text") ? "" : live.text
      const reasoning = kinds.has("thinking") || kinds.has("tool-use") ? "" : live.reasoning
      return text === live.text && reasoning === live.reasoning ? live : { text, reasoning }
    }
    default:
      return live
  }
}
