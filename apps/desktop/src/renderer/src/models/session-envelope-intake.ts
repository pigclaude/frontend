// 负责渲染层接收会话信封：按会话记下已收到的最大序号，丢掉重复的事件；发现断号时按序号补拉，
// 补齐之前到达的信封先缓存，补齐后按序号交给会话模型。

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
 * 只用于实时的事件和宿主事件直接交出，补拉期间到达的则排在补齐的事件之后。
 * 补拉失败时放弃这段断号，缓存的信封照常交出。
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
    if (sessionId === null) {
      this.#options.apply(envelope)
      return
    }
    const waiting = this.#waiting.get(sessionId)
    if (waiting !== undefined) {
      waiting.push(envelope)
      return
    }
    this.#admit(sessionId, envelope)
  }

  /** 停止接收；之后到达的信封和补拉结果都丢弃。 */
  close(): void {
    this.#closed = true
    this.#waiting.clear()
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

  async #fill(sessionId: string, targetSeq: number): Promise<void> {
    try {
      while ((this.#lastSeq.get(sessionId) ?? 0) < targetSeq - 1) {
        const last = this.#lastSeq.get(sessionId) ?? 0
        const page = await this.#options.fetch(sessionId, last)
        if (this.#closed) return
        for (const envelope of page) this.#admitFetched(sessionId, envelope)
        if ((this.#lastSeq.get(sessionId) ?? 0) === last) break
      }
    } catch {
      // 补拉失败时这段断号补不回来，缓存的信封照常交出。
    }
    if (this.#closed) return
    const waiting = this.#waiting.get(sessionId) ?? []
    this.#waiting.delete(sessionId)
    for (const envelope of waiting) this.#drain(sessionId, envelope)
  }

  #admitFetched(sessionId: string, envelope: SessionEnvelope): void {
    const last = this.#lastSeq.get(sessionId) ?? 0
    if (envelope.sessionId !== sessionId || envelope.seq !== last + 1) return
    this.#lastSeq.set(sessionId, envelope.seq)
    this.#options.apply(envelope)
  }

  // 补拉结束后交出缓存：还有断号就接受它，避免为同一段断号反复补拉。
  #drain(sessionId: string, envelope: SessionEnvelope): void {
    const seq = envelope.seq
    if (seq !== null) {
      if (seq <= (this.#lastSeq.get(sessionId) ?? 0)) return
      this.#lastSeq.set(sessionId, seq)
    }
    this.#options.apply(envelope)
  }
}
