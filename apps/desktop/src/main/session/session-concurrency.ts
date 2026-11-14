// 负责同时运行的 Claude Code 进程数：名额、排队、超出时挑最久没用的空闲会话停放，以及空闲太久自动停放。
// 只按会话 id 记账；会话是否空闲、最近活动时间和怎样停放都由会话宿主告诉它。时钟和定时器可注入。

import type { SessionTimers } from "./session-host-active"
import { SessionHostError } from "./session-types"

/** 并发控制的默认值：最多 4 个进程、最多 8 个会话排队、空闲 30 分钟停放。 */
export const defaultSessionLimits = Object.freeze({
  maxRunning: 4,
  maxQueued: 8,
  idleParkMs: 30 * 60 * 1_000,
})

/** 会话忙着时隔多久再看一次它是否已经空闲。 */
const busyRecheckMs = 60 * 1_000

/** 并发控制的依赖。 */
export type SessionConcurrencyOptions = {
  maxRunning: number
  maxQueued: number
  idleParkMs: number
  now: () => number
  timers: SessionTimers
  /** 会话的 Claude Code 在运行、没有回合、待答和后台任务。 */
  isIdle: (sessionId: string) => boolean
  /** 空闲、并且已经用过（结束过至少一轮），可以停放来给排队的会话腾位置。 */
  evictable: (sessionId: string) => boolean
  lastActivityAt: (sessionId: string) => number
  /** 停放一个会话；停放完成时宿主调用 release 交还名额。 */
  park: (sessionId: string) => void
}

type Slot = { timer: ReturnType<typeof setTimeout> | null; busySeenAt: number }

type Waiter = {
  sessionId: string
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * 进程名额。保证占着名额的会话不超过上限；排队的会话按先来先得拿到名额；只停放空闲的会话，
 * 每个排队的会话最多换掉一个空闲会话，刚拿到名额、还没用过的会话不会被换掉。
 */
export class SessionConcurrency {
  readonly #options: SessionConcurrencyOptions
  readonly #slots = new Map<string, Slot>()
  readonly #queue: Waiter[] = []
  readonly #evicting = new Set<string>()

  /** 创建空的名额表。 */
  constructor(options: SessionConcurrencyOptions) {
    this.#options = options
  }

  /**
   * 为会话占一个名额。有空位时立刻占上；满了就排队，并停放最久没用的空闲会话来腾位置。
   * 拿到名额后返回一个布尔值，说明是否排过队；排队的会话已满时抛 SESSION_LIMIT_REACHED。
   */
  acquire(sessionId: string): Promise<boolean> {
    if (this.#queue.length === 0 && this.#slots.size < this.#options.maxRunning) {
      this.#occupy(sessionId)
      return Promise.resolve(false)
    }
    if (this.#queue.length >= this.#options.maxQueued) {
      return Promise.reject(new SessionHostError("SESSION_LIMIT_REACHED", "等待启动的会话已满"))
    }
    const waiting = new Promise<boolean>((resolve, reject) => {
      this.#queue.push({ sessionId, resolve: () => resolve(true), reject })
    })
    this.#evictIdle()
    return waiting
  }

  /** 把排队的会话移出队列，它的 acquire 以 error 拒绝；不在排队时什么也不做。 */
  cancel(sessionId: string, error: Error): void {
    const index = this.#queue.findIndex((waiter) => waiter.sessionId === sessionId)
    if (index < 0) return
    const [waiter] = this.#queue.splice(index, 1)
    waiter?.reject(error)
  }

  /** 交还会话的名额并让排在最前面的会话启动；没占名额时什么也不做。 */
  release(sessionId: string): void {
    const slot = this.#slots.get(sessionId)
    if (slot === undefined) return
    this.#clearTimer(slot)
    this.#slots.delete(sessionId)
    this.#evicting.delete(sessionId)
    this.#pump()
  }

  /** 会话有了活动：空闲计时重新开始；有会话排队时再找一次可以停放的空闲会话。 */
  touch(sessionId: string): void {
    const slot = this.#slots.get(sessionId)
    if (slot !== undefined && !this.#evicting.has(sessionId)) {
      this.#arm(sessionId, slot, this.#options.idleParkMs)
    }
    // 回合结束事件发出后还有同步收尾，等检查点开始记录了再按新状态挑选空闲会话。
    if (this.#queue.length > 0) queueMicrotask(() => this.#evictIdle())
  }

  /** 清掉所有计时，排队的会话以 error 拒绝。 */
  dispose(error: Error): void {
    for (const slot of this.#slots.values()) this.#clearTimer(slot)
    for (const waiter of this.#queue.splice(0)) waiter.reject(error)
  }

  #occupy(sessionId: string): void {
    const slot: Slot = { timer: null, busySeenAt: Number.NEGATIVE_INFINITY }
    this.#slots.set(sessionId, slot)
    this.#arm(sessionId, slot, this.#options.idleParkMs)
  }

  #pump(): void {
    while (this.#queue.length > 0 && this.#slots.size < this.#options.maxRunning) {
      const waiter = this.#queue.shift()
      if (waiter === undefined) break
      this.#occupy(waiter.sessionId)
      waiter.resolve()
    }
    if (this.#queue.length > 0) this.#evictIdle()
  }

  #evictIdle(): void {
    const needed = this.#queue.length - this.#evicting.size
    if (needed <= 0) return
    const candidates = [...this.#slots.keys()]
      .filter((sessionId) => !this.#evicting.has(sessionId) && this.#options.evictable(sessionId))
      .sort((a, b) => this.#options.lastActivityAt(a) - this.#options.lastActivityAt(b))
      .slice(0, needed)
    for (const sessionId of candidates) this.#park(sessionId)
  }

  #park(sessionId: string): void {
    const slot = this.#slots.get(sessionId)
    if (slot !== undefined) this.#clearTimer(slot)
    this.#evicting.add(sessionId)
    this.#options.park(sessionId)
  }

  #arm(sessionId: string, slot: Slot, ms: number): void {
    this.#clearTimer(slot)
    slot.timer = this.#options.timers.set(() => this.#checkIdle(sessionId), ms)
  }

  #checkIdle(sessionId: string): void {
    const slot = this.#slots.get(sessionId)
    if (slot === undefined || this.#evicting.has(sessionId)) return
    slot.timer = null
    const now = this.#options.now()
    if (!this.#options.isIdle(sessionId)) {
      slot.busySeenAt = now
      this.#arm(sessionId, slot, Math.min(busyRecheckMs, this.#options.idleParkMs))
      return
    }
    const since = Math.max(this.#options.lastActivityAt(sessionId), slot.busySeenAt)
    const remaining = since + this.#options.idleParkMs - now
    if (remaining > 0) this.#arm(sessionId, slot, remaining)
    else this.#park(sessionId)
  }

  #clearTimer(slot: Slot): void {
    if (slot.timer === null) return
    this.#options.timers.clear(slot.timer)
    slot.timer = null
  }
}
