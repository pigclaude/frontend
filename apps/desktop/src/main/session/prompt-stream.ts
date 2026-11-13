// 提供 SDK 单消费者输入流，结束时释放所有等待中的读取操作。
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"

/** 会话提示词流；停止后拒绝写入，已排队的消息仍按原顺序读取。 */
export class PromptStream implements AsyncIterable<SDKUserMessage> {
  #values: SDKUserMessage[] = []
  #waiters: ((result: IteratorResult<SDKUserMessage>) => void)[] = []
  #ended = false

  /** 将一条用户消息交给正在等待的 SDK，或加入队尾。 */
  push(message: SDKUserMessage): void {
    if (this.#ended) throw new Error("session prompt stream is closed")
    const waiter = this.#waiters.shift()
    if (waiter === undefined) this.#values.push(message)
    else waiter({ done: false, value: message })
  }

  /** 标记输入结束并释放所有等待的读取。 */
  end(): void {
    if (this.#ended) return
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  /** SDK 通过异步迭代消费提示词。 */
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return { next: () => this.#next() }
  }

  #next(): Promise<IteratorResult<SDKUserMessage>> {
    const value = this.#values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.#ended) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve) => this.#waiters.push(resolve))
  }
}
