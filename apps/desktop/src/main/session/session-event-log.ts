// 负责一个会话的事件时钟和内存事件日志：给事件盖时间和序号，并按序号读出要保存的事件。
// 只属于一个会话，不依赖会话宿主。

import { sessionEnvelopeVersion, sessionEventKinds, type SessionEnvelope } from "./session-envelope"
import type { SessionHostEvent } from "./session-types"

/** 一次补拉最多返回的事件数；渲染层拿满一页后接着拉。 */
export const maxEnvelopesPerRead = 500

/** 一个会话的事件日志。保证时间不倒退、要保存的事件从 1 连续编号，读出的事件按序号排列。 */
export class SessionEventLog {
  readonly #sessionId: string
  readonly #now: () => number
  readonly #kept: SessionEnvelope[] = []
  #lastAt = Number.NEGATIVE_INFINITY

  /** 创建空日志；now 是主进程的时钟。 */
  constructor(sessionId: string, now: () => number) {
    this.#sessionId = sessionId
    this.#now = now
  }

  /** 给事件盖上时间，要保存的事件再编上下一个序号并记入日志。 */
  append(event: SessionHostEvent): SessionEnvelope {
    this.#lastAt = Math.max(this.#now(), this.#lastAt)
    const persisted = sessionEventKinds[event.type] === "persisted"
    const envelope: SessionEnvelope = {
      version: sessionEnvelopeVersion,
      sessionId: this.#sessionId,
      seq: persisted ? this.#kept.length + 1 : null,
      at: new Date(this.#lastAt).toISOString(),
      event,
    }
    if (persisted) this.#kept.push(envelope)
    return envelope
  }

  /** 读出序号大于 afterSeq 的要保存的事件，按序号排列，最多 maxEnvelopesPerRead 条。 */
  since(afterSeq: number): SessionEnvelope[] {
    return this.#kept.slice(afterSeq, afterSeq + maxEnvelopesPerRead)
  }
}
