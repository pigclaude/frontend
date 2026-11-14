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
  apply: (envelope: SessionEnvelope, replay?: boolean) => void
}

/**
 * 会话信封接收器。保证同一会话要保存的事件按序号交出、每个序号只交一次，磁盘上的坏行不妨碍后面的记录；
 * 只用于实时的事件和宿主事件直接交出，补拉期间到达的则排在补齐的事件之后、保持到达顺序。
 * 补拉失败或拉不到时放弃这段断号，缓存的信封照常交出。
 */
export class SessionEnvelopeIntake {
  readonly #options: SessionEnvelopeIntakeOptions
  readonly #lastSeq = new Map<string, number>()
  readonly #waiting = new Map<string, SessionEnvelope[]>()
  readonly #caughtUp = new Set<string>()
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

  /** 正在读选中会话的历史时，新回合必须等它读完。 */
  isCatchingUp(sessionId: string): boolean {
    return this.#waiting.has(sessionId)
  }

  /** 磁盘历史已读尽或是本窗口新建的会话，可以发起下一轮。 */
  hasHistory(sessionId: string): boolean {
    return this.#caughtUp.has(sessionId)
  }

  /** 补拉选中会话的历史，直到主进程返回空页；失败后下次可从同一游标重试。 */
  async catchUp(sessionId: string): Promise<void> {
    if (this.#closed || this.#caughtUp.has(sessionId) || this.#waiting.has(sessionId)) return
    this.#waiting.set(sessionId, [])
    await this.#fill(sessionId, null)
  }

  /** 新建会话从空历史开始，不需要阻挡它第一次发送。 */
  startedHere(sessionId: string): void {
    this.#caughtUp.add(sessionId)
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

  // 补到断号之前或当前历史末尾，再按到达顺序交出缓存。
  async #fill(sessionId: string, targetSeq: number | null): Promise<void> {
    const last = (): number => this.#lastSeq.get(sessionId) ?? 0
    try {
      while (targetSeq === null || last() < targetSeq - 1) {
        const before = last()
        const page = await this.#options.fetch(sessionId, before)
        if (this.#closed) return
        if (targetSeq === null && page.length === 0) this.#caughtUp.add(sessionId)
        for (const envelope of [...page].sort(compareSeq)) {
          const seq = envelope.seq
          if (envelope.sessionId !== sessionId || seq === null || seq <= last()) continue
          if (targetSeq !== null && seq >= targetSeq) break
          this.#lastSeq.set(sessionId, seq)
          this.#options.apply(envelope, targetSeq === null)
        }
        if (last() === before) break
      }
    } catch {
      // 补拉失败时这段断号补不回来，缓存的信封照常交出。
    }
    if (this.#closed) return
    if (targetSeq !== null) this.#lastSeq.set(sessionId, Math.max(last(), targetSeq - 1))
    const waiting = this.#waiting.get(sessionId) ?? []
    this.#waiting.delete(sessionId)
    for (const envelope of waiting) this.#route(sessionId, envelope)
  }
}

function compareSeq(left: SessionEnvelope, right: SessionEnvelope): number {
  return (left.seq ?? 0) - (right.seq ?? 0)
}
