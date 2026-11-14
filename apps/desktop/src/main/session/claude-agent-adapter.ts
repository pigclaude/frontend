// 负责包装 Claude Agent SDK 的 query：管理一次会话的发送、中断、停止和控制请求，把 SDK 消息转发为应用事件。

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { queryClaudeModels, type ClaudeModelsOptions } from "./claude-model-query"
import { closeQuietly, defaultQueryFn, type AdapterQuery, type QueryFn } from "./claude-query"
import { buildQueryOptions, type ClaudeAgentStartOptions } from "./claude-query-options"
import { normalizeSdkMessage } from "./claude-sdk-messages"
import { PromptStream } from "./prompt-stream"
import { classifyDaemonError } from "./session-error-mapping"
import type { AdapterEvent, ClaudeModel, SessionPermissionMode } from "./session-events"

export type {
  AdapterEvent,
  ClaudeModel,
  SessionContentBlock,
  SessionEvent,
  SessionPermissionMode,
  SessionThinking,
  SessionUsage,
} from "./session-events"

/** 适配器构造参数；所有外部依赖都可注入，便于不启动真实 CLI 的测试。 */
export type ClaudeAgentAdapterOptions = {
  queryFn?: QueryFn
  resolveBinaryPath?: () => string
  onEvent?: (event: AdapterEvent) => void
  /** 一次性模型查询的有界等待时间；超时后关闭 query 并抛出可读错误。 */
  modelsTimeoutMs?: number
}

/** 包装 SDK query 的会话适配器。保证同一实例只开始一次会话，停止和并发中断可安全重复调用。 */
export class ClaudeAgentAdapter {
  readonly #queryFn: QueryFn
  readonly #resolveBinaryPath: () => string
  readonly #onEvent: ((event: AdapterEvent) => void) | undefined
  readonly #modelsTimeoutMs: number
  #query: AdapterQuery | null = null
  #prompt: PromptStream | null = null
  #started = false
  #stopped = false
  #endedEmitted = false
  #startPromise: Promise<void> | null = null
  #pumpPromise: Promise<void> | null = null
  #stopPromise: Promise<void> | null = null
  #interruptPromise: Promise<void> | null = null

  constructor(options: ClaudeAgentAdapterOptions = {}) {
    this.#queryFn = options.queryFn ?? defaultQueryFn
    this.#resolveBinaryPath = options.resolveBinaryPath ?? (() => resolveClaudeBinaryPath())
    this.#onEvent = options.onEvent
    this.#modelsTimeoutMs = options.modelsTimeoutMs ?? 15_000
  }

  /** 调用 SDK query 并开始消费消息。二进制解析、选项构建或 query 启动失败时广播 error/ended 后重新抛出。 */
  async start(options: ClaudeAgentStartOptions): Promise<void> {
    if (this.#started) throw new Error("SESSION_ALREADY_ACTIVE: adapter already started")
    this.#started = true
    const prompt = new PromptStream()
    this.#prompt = prompt
    const task = this.#startQuery(options, prompt)
    this.#startPromise = task
    try {
      await task
    } finally {
      if (this.#startPromise === task) this.#startPromise = null
    }
  }

  // queryFn 可能晚于 stop 才返回；此时仍要关闭查询，避免留下孤儿 CLI 进程。
  async #startQuery(options: ClaudeAgentStartOptions, prompt: PromptStream): Promise<void> {
    let query: AdapterQuery
    try {
      const sdkOptions = buildQueryOptions(options, options.binaryPath ?? this.#resolveBinaryPath())
      query = await this.#queryFn({ prompt, options: sdkOptions })
    } catch (error) {
      if (this.#stopped) throw error
      this.#emitError(error)
      this.#finish("error")
      throw error
    }
    this.#query = query
    if (this.#stopped) {
      this.#finish("stopped")
      return
    }
    this.#pumpPromise = this.#pump(query)
  }

  /** 把一条用户消息写入 SDK 的流式输入；会话未启动或已停止时抛出。 */
  async send(text: string): Promise<void> {
    const prompt = this.#prompt
    if (prompt === null || this.#stopped) throw new Error("session is not active")
    prompt.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: "",
    })
  }

  /** 中断当前 turn；并发调用共享同一个 SDK interrupt，停止后为空操作。 */
  interrupt(): Promise<void> {
    if (this.#interruptPromise !== null) return this.#interruptPromise
    const query = this.#query
    if (query === null || this.#stopped) return Promise.resolve()
    const pending: Promise<void> = query
      .interrupt()
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.#interruptPromise === pending) this.#interruptPromise = null
      })
    this.#interruptPromise = pending
    return pending
  }

  /** 停止一个在途的后台任务；任务已经结束、会话未启动或已停止时什么也不做。 */
  async stopTask(taskId: string): Promise<void> {
    const query = this.#query
    if (query === null || this.#stopped) return
    await query.stopTask(taskId).catch(() => undefined)
  }

  /**
   * 结束输入流并关闭 SDK 进程；重复调用返回同一个 Promise，ended 只广播一次。未启动时不缓存。
   * 保证返回前等待在途的 query 创建和消息迭代结束，调用方随后清理目录不会与 CLI 启动竞态。
   */
  stop(): Promise<void> {
    if (!this.#started) return Promise.resolve()
    if (this.#stopPromise !== null) return this.#stopPromise
    this.#stopPromise = this.#stopAndWait()
    return this.#stopPromise
  }

  async #stopAndWait(): Promise<void> {
    this.#finish("stopped")
    const start = this.#startPromise
    if (start !== null) await start.catch(() => undefined)
    const pump = this.#pumpPromise
    if (pump !== null) await pump.catch(() => undefined)
  }

  /**
   * 启动一次性 query 读取 SDK 支持的模型，读完立即关闭；不广播会话事件。
   * 保证整次查询有界：超时或取消时关闭 query、结束输入流并抛出可读错误。
   */
  async models(options: ClaudeModelsOptions = {}): Promise<ClaudeModel[]> {
    return queryClaudeModels({
      ...options,
      queryFn: this.#queryFn,
      binaryPath: options.binaryPath ?? this.#resolveBinaryPath(),
      timeoutMs: options.timeoutMs ?? this.#modelsTimeoutMs,
    })
  }

  /** 切换后续工具调用的权限模式；正在等待的 canUseTool 请求不受影响。会话未启动时抛错。 */
  async setPermissionMode(mode: SessionPermissionMode): Promise<void> {
    const query = this.#requireQuery()
    await query.setPermissionMode(mode)
  }

  /** 切换后续回复使用的模型；会话未启动时抛错。 */
  async setModel(model: string): Promise<void> {
    const query = this.#requireQuery()
    await query.setModel(model)
  }

  /** 用 summary 模式查询当前上下文占用，原样返回 SDK 的回复；会话未启动或已停止时抛错。 */
  async contextUsage(): Promise<unknown> {
    const query = this.#requireQuery()
    return query.getContextUsage({ detail: "summary" })
  }

  // 控制请求只对已启动且未结束的 query 有效；否则不静默吞掉调用方的意图。
  #requireQuery(): AdapterQuery {
    if (this.#query === null || this.#stopped) throw new Error("session is not active")
    return this.#query
  }

  // 所有结束路径共用：清空目标、关闭查询并只广播一次 ended。
  #finish(reason: "completed" | "stopped" | "error"): void {
    this.#stopped = true
    const prompt = this.#prompt
    this.#prompt = null
    prompt?.end()
    const query = this.#query
    this.#query = null
    if (query !== null) closeQuietly(query)
    this.#emitEnded(reason)
  }

  async #pump(query: AdapterQuery): Promise<void> {
    try {
      for await (const message of query) this.#handleMessage(message)
      if (!this.#stopped) this.#finish("completed")
    } catch (error) {
      if (this.#stopped) return
      this.#emitError(error)
      this.#finish("error")
    }
  }

  #handleMessage(message: SDKMessage): void {
    const events = normalizeSdkMessage(message)
    if (events.length === 0) this.#emit({ type: "sdk-activity" })
    for (const event of events) this.#emit(event)
  }

  #emit(event: AdapterEvent): void {
    try {
      this.#onEvent?.(event)
    } catch {
      // 单个订阅者失败不能中断 SDK 消息消费。
    }
  }

  #emitError(error: unknown): void {
    const message = errorMessage(error)
    this.#emit({ type: "error", code: classifyDaemonError(message) ?? "SDK_ERROR", message })
  }

  #emitEnded(reason: "completed" | "stopped" | "error"): void {
    if (this.#endedEmitted) return
    this.#endedEmitted = true
    this.#emit({ type: "ended", reason })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
