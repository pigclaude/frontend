// 负责渲染层接收会话信封：按会话记下已收到的最大序号，丢掉重复的事件；发现断号时按序号补拉，
// 补齐之前到达的信封先缓存，补齐后按到达顺序交给会话模型。

import type { SessionEnvelope } from "../../../main/session/session-envelope"

/** 按序号补拉一个会话要保存的事件；返回序号大于 afterSeq 的部分，按序号排列，可能只是一页。 */
export type SessionEnvelopeFetch = (
  sessionId: string,
  afterSeq: number,
) => Promise<SessionEnvelope[]>

/** 接收器的依赖：补拉接口和把信封交给会话模型的出口。 */
export type SessionEnvelopeIntakeOptions = {
  fetch: SessionEnvelopeFetch
  apply: (envelope: SessionEnvelope) => void
}

/**
 * 会话信封接收器。保证同一会话要保存的事件按序号连续交出、每个序号只交一次；
 * 只用于实时的事件和宿主事件直接交出，补拉期间到达的则排在补齐的事件之后、保持到达顺序。
 * 补拉失败或拉不到时放弃这段断号，缓存的信封照常交出。
 */
export class SessionEnvelopeIntake {
  readonly #options: SessionEnvelopeIntakeOptions
  readonly #lastSeq = new Map<string, number>()
  readonly #waiting = new Map<string, SessionEnvelope[]>()
  #closed = false

  /** 创建接收器；每个会话的已收序号从 0 开始。 */
  constructor(options: SessionEnvelopeIntakeOptions) {
    this.#options = options
  }

  /** 接收一条信封。 */
  receive(envelope: SessionEnvelope): void {
    if (this.#closed) return
    const { sessionId } = envelope
    if (sessionId === null) this.#options.apply(envelope)
    else this.#route(sessionId, envelope)
  }

  /** 停止接收；之后到达的信封和补拉结果都丢弃。 */
  close(): void {
    this.#closed = true
    this.#waiting.clear()
  }

  #route(sessionId: string, envelope: SessionEnvelope): void {
    const waiting = this.#waiting.get(sessionId)
    if (waiting !== undefined) waiting.push(envelope)
    else this.#admit(sessionId, envelope)
  }

  #admit(sessionId: string, envelope: SessionEnvelope): void {
    const seq = envelope.seq
    if (seq === null) {
      this.#options.apply(envelope)
      return
    }
    const last = this.#lastSeq.get(sessionId) ?? 0
    if (seq <= last) return
    if (seq === last + 1) {
      this.#lastSeq.set(sessionId, seq)
      this.#options.apply(envelope)
      return
    }
    this.#waiting.set(sessionId, [envelope])
    void this.#fill(sessionId, seq)
  }

  // 只补到断号之前；断号处及之后的事件都在缓存里，按到达顺序和夹在中间的实时事件一起交出。
  async #fill(sessionId: string, targetSeq: number): Promise<void> {
    const last = (): number => this.#lastSeq.get(sessionId) ?? 0
    try {
      while (last() < targetSeq - 1) {
        const before = last()
        const page = await this.#options.fetch(sessionId, before)
        if (this.#closed) return
        for (const envelope of page) {
          if (envelope.sessionId !== sessionId || envelope.seq !== last() + 1) continue
          if (envelope.seq >= targetSeq) break
          this.#lastSeq.set(sessionId, envelope.seq)
          this.#options.apply(envelope)
        }
        if (last() === before) break
      }
    } catch {
      // 补拉失败时这段断号补不回来，缓存的信封照常交出。
    }
    if (this.#closed) return
    this.#lastSeq.set(sessionId, Math.max(last(), targetSeq - 1))
    const waiting = this.#waiting.get(sessionId) ?? []
    this.#waiting.delete(sessionId)
    for (const envelope of waiting) this.#route(sessionId, envelope)
  }
}
