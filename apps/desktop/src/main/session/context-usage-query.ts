// 负责一个会话的上下文占用查询：第一次 init 之后、每个 result 之后、上下文压缩之后，以及会话要求时
// （换模型、换号）查询，把结果作为 context 事件发出。同一时间只查一次，失败不提示，不定时轮询。
// 只依赖这一个会话的查询入口和事件出口，不引用会话宿主。

import { contextEventFromReply, type SessionContextEvent } from "./context-usage"
import type { AdapterEvent } from "./session-events"

/** 查询需要的两个出口：读这一个会话的上下文占用，以及发出 context 事件。 */
export type ContextUsageQueryOptions = {
  read: () => Promise<unknown>
  emit: (event: SessionContextEvent) => void
}

/**
 * 一个会话的上下文占用查询。保证第一次 init 之前不查询；同一时间最多一次在途查询，在途期间再来的请求
 * 合并成它结束后的一次补查；查询失败、回复不可用或事件出口出错时什么也不发，之后照常查询；
 * 停止后不再查询，在途查询的结果也丢掉。
 */
export class ContextUsageQuery {
  readonly #options: ContextUsageQueryOptions
  #initialized = false
  #running = false
  #again = false
  #stopped = false

  /** 创建查询；不立即查询。 */
  constructor(options: ContextUsageQueryOptions) {
    this.#options = options
  }

  /** 看一条适配器事件：第一次 init、每个 result 和每次上下文压缩之后各查一次。 */
  observe(event: AdapterEvent): void {
    if (event.type === "started") {
      if (this.#initialized) return
      this.#initialized = true
      this.request()
    } else if (event.type === "result" || event.type === "context-compacted") {
      this.request()
    }
  }

  /** 查询一次；已有查询在途时不另查，在它结束后最多再查一次。第一次 init 之前和停止后什么也不做。 */
  request(): void {
    if (this.#stopped || !this.#initialized) return
    if (this.#running) {
      this.#again = true
      return
    }
    this.#running = true
    void this.#run()
  }

  /** 停止查询：之后的请求都忽略，在途查询的结果不再发出。可重复调用。 */
  stop(): void {
    this.#stopped = true
    this.#again = false
  }

  async #run(): Promise<void> {
    try {
      do {
        this.#again = false
        const event = await Promise.resolve()
          .then(() => this.#options.read())
          .then(contextEventFromReply, () => null)
        try {
          if (event !== null && !this.#stopped) this.#options.emit(event)
        } catch {
          // 事件出口出错只丢掉这一次结果，之后的查询照常进行。
        }
      } while (this.#again)
    } finally {
      this.#running = false
    }
  }
}
