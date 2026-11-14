// 定义主进程发给渲染层的会话事件信封：格式版本、会话 id、序号、时间和事件本身，
// 以及每种事件要保存还是只用于实时。只有类型和常量，preload 也会引用。

import type { SessionHostEvent } from "./session-types"

/** 信封的格式版本。 */
export const sessionEnvelopeVersion = 1

/** 事件的去向：要保存的事件有序号，可以补拉；只用于实时的事件没有序号，丢了不补。 */
export type SessionEventKind = "persisted" | "live"

/** 每种事件类型的去向。表是穷举的：会话宿主新增事件类型时不在这里归类，类型检查不通过。 */
export const sessionEventKinds: Readonly<Record<SessionHostEvent["type"], SessionEventKind>> = {
  started: "persisted",
  mode: "persisted",
  delta: "live",
  message: "persisted",
  "tool-result": "persisted",
  permission: "persisted",
  question: "persisted",
  "question-resolved": "persisted",
  "account-switched": "persisted",
  notice: "persisted",
  result: "persisted",
  "turn-started": "persisted",
  "turn-ended": "persisted",
  error: "persisted",
  ended: "persisted",
}

/**
 * 一条会话事件。at 是主进程记录的 ISO UTC 时间，同一会话内不倒退；seq 只给要保存的事件，
 * 同一会话从 1 递增，排序只看 seq。宿主自己的提示（例如模型目录降级）不属于任何会话，
 * sessionId 和 seq 都是 null，只用于实时。
 */
export type SessionEnvelope = {
  version: typeof sessionEnvelopeVersion
  sessionId: string | null
  seq: number | null
  at: string
  event: SessionHostEvent
}

/** 包装一条不属于任何会话的宿主事件。 */
export function hostEnvelope(event: SessionHostEvent, now: number): SessionEnvelope {
  return {
    version: sessionEnvelopeVersion,
    sessionId: null,
    seq: null,
    at: new Date(now).toISOString(),
    event,
  }
}
