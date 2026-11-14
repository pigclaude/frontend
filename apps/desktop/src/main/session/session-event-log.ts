// 负责一个会话的事件时钟和内存事件日志：给事件盖时间和序号，并按序号读出要保存的事件。
// 只属于一个会话，不依赖会话宿主。

import { sessionEnvelopeVersion, sessionEventKinds, type SessionEnvelope } from "./session-envelope"
import type { SessionHostEvent } from "./session-types"

/** 一次补拉最多返回的事件数；渲染层拿满一页后接着拉。 */
export const maxEnvelopesPerRead = 500

/** 磁盘历史的序号和时间上界，时间为 Unix 毫秒。 */
export type SessionEventCursor = { seq: number; at: number }

/** 一个会话的内存事件日志。时间不倒退，要保存的事件从历史最大序号之后连续编号。 */
export class SessionEventLog {
  readonly #sessionId: string
  readonly #now: () => number
  readonly #initialSeq: number
  readonly #kept: SessionEnvelope[] = []
  #lastAt: number

  /** 创建空日志，用可选的磁盘游标确定第一条新信封的序号和时间下界。 */
  constructor(sessionId: string, now: () => number, cursor?: SessionEventCursor) {
    this.#sessionId = sessionId
    this.#now = now
    this.#initialSeq = cursor?.seq ?? 0
    this.#lastAt = cursor?.at ?? Number.NEGATIVE_INFINITY
  }

  /** 给事件盖上时间，要保存的事件再编上下一个序号并记入日志。 */
  append(event: SessionHostEvent): SessionEnvelope {
    this.#lastAt = Math.max(this.#now(), this.#lastAt)
    const persisted = sessionEventKinds[event.type] === "persisted"
    const envelope: SessionEnvelope = {
      version: sessionEnvelopeVersion,
      sessionId: this.#sessionId,
      seq: persisted ? this.#initialSeq + this.#kept.length + 1 : null,
      at: new Date(this.#lastAt).toISOString(),
      event,
    }
    if (persisted) this.#kept.push(envelope)
    return envelope
  }

  /** 读出当前日志中序号大于 afterSeq 的事件，按序号排列，最多 maxEnvelopesPerRead 条。 */
  since(afterSeq: number): SessionEnvelope[] {
    const offset = Math.max(0, afterSeq - this.#initialSeq)
    return this.#kept.slice(offset, offset + maxEnvelopesPerRead)
  }
}
