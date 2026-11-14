// 会话测试用的手动时钟：给会话宿主一个只在测试拨动时才前进的时钟和定时器，空闲停放和超时可以不等真实时间。

import type { SessionTimers } from "./session-host-active"

type Pending = { due: number; callback: () => void }

/** 手动前进的时钟和定时器。保证到期的回调按到期时间先后执行，清掉的定时器不再执行。 */
export class ManualClock {
  #now: number
  readonly #pending = new Map<ReturnType<typeof setTimeout>, Pending>()

  /** 从 start 毫秒开始计时。 */
  constructor(start: number) {
    this.#now = start
  }

  /** 当前时间（毫秒）。 */
  readonly now = (): number => this.#now

  /** 交给宿主的定时器；句柄只用作标识，不会被真实事件循环执行。 */
  readonly timers: SessionTimers = {
    set: (callback, ms) => {
      const handle = setTimeout(() => undefined, 0)
      clearTimeout(handle)
      this.#pending.set(handle, { due: this.#now + ms, callback })
      return handle
    },
    clear: (handle) => {
      this.#pending.delete(handle)
    },
  }

  /** 把时钟往前拨 ms 毫秒，依次执行这期间到期的回调（含回调里新设、也在期间内到期的）。 */
  advance(ms: number): void {
    const target = this.#now + ms
    for (;;) {
      const next = [...this.#pending.entries()]
        .filter(([, pending]) => pending.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0]
      if (next === undefined) break
      const [handle, pending] = next
      this.#pending.delete(handle)
      this.#now = Math.max(this.#now, pending.due)
      pending.callback()
    }
    this.#now = target
  }
}
