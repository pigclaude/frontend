// 负责一个会话里等用户回答的请求（权限询问和提问）的共用队列：每个请求只结算一次，
// SDK 中止、超时和整体拒绝时按拒绝结算，并按种类计数。请求内容和给 SDK 的结果由各自的代理决定。

import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk"

/** 等待回答的请求种类。 */
export type PendingAnswerKind = "permission" | "question"

/**
 * 一个请求的结算结果：代理按用户的回答给出的 SDK 结果；SDK 中止了请求或超时没人回答；
 * 或者被整体拒绝（停止、取消、会员失效等），message 是整体拒绝给的原因。
 */
export type PendingOutcome =
  | { type: "answered"; result: PermissionResult }
  | { type: "denied"; reason: "aborted" | "timeout" }
  | { type: "denied"; reason: "rejected"; message: string }

/** 加入队列的一个请求；settle 只会被调用一次，onTimeout 在超时结算之后调用。 */
export type PendingAnswer = {
  kind: PendingAnswerKind
  signal: AbortSignal
  settle: (outcome: PendingOutcome) => void
  onTimeout?: () => void
}

/** 队列用的定时器和超时；测试可以换成假定时器。 */
export type PendingAnswersOptions = {
  timeoutMs: number
  setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void
}

type Entry = PendingAnswer & {
  timer: ReturnType<typeof setTimeout>
  abortListener: () => void
}

/** 等待回答的请求队列。保证每个请求只结算一次；结算时先移出队列、清掉定时器和中止监听。 */
export class PendingAnswers {
  readonly #options: PendingAnswersOptions
  readonly #entries = new Map<string, Entry>()

  /** 创建空队列；每个请求在 timeoutMs 之后按超时拒绝。 */
  constructor(options: PendingAnswersOptions) {
    this.#options = options
  }

  /** 某一种还没结算的请求数；不给种类时是全部。 */
  count(kind?: PendingAnswerKind): number {
    if (kind === undefined) return this.#entries.size
    let count = 0
    for (const entry of this.#entries.values()) if (entry.kind === kind) count += 1
    return count
  }

  /** 加入一个请求并开始计时；signal 中止时按拒绝结算。 */
  add(requestId: string, request: PendingAnswer): void {
    const abortListener = (): void => {
      this.#settle(requestId, { type: "denied", reason: "aborted" })
    }
    const timer = this.#options.setTimer(() => this.#expire(requestId), this.#options.timeoutMs)
    this.#entries.set(requestId, { ...request, timer, abortListener })
    request.signal.addEventListener("abort", abortListener, { once: true })
  }

  /** 按用户的回答结算某一种请求；请求未知、已结算或种类不符时返回 false。 */
  answer(requestId: string, kind: PendingAnswerKind, result: PermissionResult): boolean {
    if (this.#entries.get(requestId)?.kind !== kind) return false
    this.#settle(requestId, { type: "answered", result })
    return true
  }

  /** 按拒绝结算全部还没结算的请求；用于停止、取消、超时、会话结束和会员失效。 */
  rejectAll(message: string): void {
    for (const requestId of [...this.#entries.keys()]) {
      this.#settle(requestId, { type: "denied", reason: "rejected", message })
    }
  }

  #expire(requestId: string): void {
    const entry = this.#entries.get(requestId)
    if (entry === undefined) return
    this.#settle(requestId, { type: "denied", reason: "timeout" })
    try {
      entry.onTimeout?.()
    } catch {
      // 超时回调失败不能影响队列里的其它请求。
    }
  }

  #settle(requestId: string, outcome: PendingOutcome): void {
    const entry = this.#entries.get(requestId)
    if (entry === undefined) return
    this.#entries.delete(requestId)
    this.#options.clearTimer(entry.timer)
    entry.signal.removeEventListener("abort", entry.abortListener)
    entry.settle(outcome)
  }
}
