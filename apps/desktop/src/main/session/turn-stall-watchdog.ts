// 负责一个会话的停滞计时：空闲时间满两分钟时提醒一次，等待用户回答时不计时。

import type { SessionTimers } from "./session-host-active"

/** 一轮连续没有 SDK 消息时发出提示的等待时间。 */
export const turnStallMs = 120_000

/** 每个会话一份看门狗，停滞提示不改变回合运行状态。 */
export class TurnStallWatchdog {
  #remaining: number | null = null
  #waiting = false
  #armedAt = 0
  #timer: ReturnType<typeof setTimeout> | null = null

  /** 注入会话的时钟、定时器和提示出口。 */
  constructor(
    private readonly timers: SessionTimers,
    private readonly now: () => number,
    private readonly notify: () => void,
  ) {}

  /** 开始一轮，从头计算空闲时间。 */
  start(): void {
    this.stop()
    this.#remaining = turnStallMs
    this.#arm()
  }

  /** 每条 SDK 消息都重新开始计时，已经提示过的回合保持原状。 */
  activity(): void {
    if (this.#remaining === null) return
    this.#clear()
    this.#remaining = turnStallMs
    this.#arm()
  }

  /** 尚有待答请求时暂停，全部结算后从暂停的位置继续。 */
  setWaiting(waiting: boolean): void {
    if (waiting === this.#waiting) return
    this.#waiting = waiting
    if (!waiting) {
      this.#arm()
    } else if (this.#timer !== null && this.#remaining !== null) {
      this.#remaining = Math.max(0, this.#remaining - Math.max(0, this.now() - this.#armedAt))
      this.#clear()
    }
  }

  /** 结束或取消回合时撤掉定时器。 */
  stop(): void {
    this.#remaining = null
    this.#clear()
  }

  #arm(): void {
    if (this.#waiting || this.#remaining === null) return
    this.#armedAt = this.now()
    this.#timer = this.timers.set(() => {
      this.stop()
      this.notify()
    }, this.#remaining)
  }

  #clear(): void {
    if (this.#timer === null) return
    this.timers.clear(this.#timer)
    this.#timer = null
  }
}
