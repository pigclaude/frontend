// 提供 ClaudeAgentAdapter 测试共用的假 SDK 查询、消息队列和启动参数；不接触真实 CLI 或网络。

import type { ModelInfo, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { AdapterQuery, QueryFn } from "./claude-query"
import type { ClaudeAgentStartOptions } from "./claude-query-options"

/** 测试捕获到的 query 参数。 */
export type CapturedQuery = {
  prompt: string | AsyncIterable<SDKUserMessage>
  options: Options
}

/** 构造一次合法会话启动参数；不指定 binaryPath，让测试可以覆盖解析器。 */
export function startOptions(): ClaudeAgentStartOptions {
  return {
    workspace: "/tmp/workspace",
    env: {},
    permissionMode: "default",
    canUseTool: async () => ({ behavior: "allow" }),
    abortController: new AbortController(),
  }
}

/** 返回一个记录参数的 queryFn，并固定返回给定的假查询。 */
export function capture(fake: FakeQuery, captured: CapturedQuery[]): QueryFn {
  return (params) => {
    captured.push(params)
    return fake
  }
}

/** 单消费者的异步队列，用于模拟 SDK 消息流和失败。 */
class AsyncQueue<T> implements AsyncIterator<T> {
  #values: T[] = []
  #waiters: { resolve: (result: IteratorResult<T>) => void; reject: (error: Error) => void }[] = []
  #failure: Error | null = null
  #done = false

  push(value: T): void {
    if (this.#done) return
    const waiter = this.#waiters.shift()
    if (waiter === undefined) this.#values.push(value)
    else waiter.resolve({ done: false, value })
  }

  end(): void {
    if (this.#done) return
    this.#done = true
    for (const waiter of this.#waiters.splice(0)) waiter.resolve({ done: true, value: undefined })
  }

  fail(error: Error): void {
    if (this.#done) return
    this.#failure = error
    this.#done = true
    for (const waiter of this.#waiters.splice(0)) waiter.reject(error)
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.#values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.#failure !== null) return Promise.reject(this.#failure)
    if (this.#done) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }))
  }
}

/** 假的 SDK query，实现适配器需要的迭代、interrupt、stopTask、close 和 supportedModels。 */
export class FakeQuery implements AdapterQuery {
  readonly #messages = new AsyncQueue<SDKMessage>()
  readonly #models: ModelInfo[]
  readonly permissionModes: string[] = []
  readonly modelChanges: (string | undefined)[] = []
  /** 中断和停止单个任务的控制请求，按到达顺序，形如 interrupt、stopTask:<id>。 */
  readonly controls: string[] = []
  /** 中断返回之后调用；测试用它模拟中断后才到达的消息。 */
  afterInterrupt: (() => void) | null = null
  interrupts = 0
  closes = 0

  constructor(models: ModelInfo[] = []) {
    this.#models = models
  }

  emit(message: SDKMessage): void {
    this.#messages.push(message)
  }

  end(): void {
    this.#messages.end()
  }

  fail(error: Error): void {
    this.#messages.fail(error)
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.#messages
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1
    this.controls.push("interrupt")
    const after = this.afterInterrupt
    if (after !== null) setTimeout(after, 0)
  }

  /** 只记下请求，不发任务通知；测试需要时自己推送。 */
  async stopTask(taskId: string): Promise<void> {
    this.controls.push(`stopTask:${taskId}`)
  }

  close(): void {
    this.closes += 1
    this.#messages.end()
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return this.#models
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.permissionModes.push(mode)
  }

  async setModel(model?: string): Promise<void> {
    this.modelChanges.push(model)
  }

  /** 缺省接受会话级 flag；需要记录或挂起响应的测试可覆盖。 */
  async applyFlagSettings(): Promise<void> {}

  /** 上下文占用查询收到的参数，按调用顺序。 */
  readonly contextRequests: unknown[] = []
  /** 每次上下文占用查询的回复；缺省失败（不发事件），测试可以换成录制的回复或挂起的 Promise。 */
  contextReply: () => Promise<unknown> = () => Promise.reject(new Error("no context reply"))

  /** 记下查询参数，按 contextReply 回复。 */
  getContextUsage(options: { detail: "summary" }): Promise<unknown> {
    this.contextRequests.push(options)
    return this.contextReply()
  }
}

/** 把适配器写入的 prompt 流收集到数组，便于断言 send 的内容。 */
export async function collectPrompt(
  prompt: string | AsyncIterable<SDKUserMessage>,
  messages: SDKUserMessage[],
): Promise<void> {
  if (typeof prompt === "string") return
  for await (const message of prompt) messages.push(message)
}

/** 轮询等待条件成立，避免测试依赖固定延时。 */
export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("condition was not reached")
}
