// 负责包装 Claude Agent SDK 的 query：固定会话选项，把 SDK 消息映射为应用事件，并管理发送、中断、停止和模型查询。

import type {
  CanUseTool,
  ModelInfo,
  Options,
  SDKMessage,
  SDKUserMessage,
  ThinkingConfig,
} from "@anthropic-ai/claude-agent-sdk"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { mergeClaudeModels } from "./claude-model-catalog"
import { classifyDaemonError } from "./session-error-mapping"
import type {
  ClaudeModel,
  SessionContentBlock,
  SessionEffort,
  SessionEvent,
  SessionPermissionMode,
  SessionThinking,
} from "./session-events"

export type {
  ClaudeModel,
  SessionContentBlock,
  SessionEvent,
  SessionPermissionMode,
  SessionThinking,
  SessionUsage,
} from "./session-events"

/** SDK query 返回对象的最小端口；真实 Query 和测试假实现都满足。 */
export type AdapterQuery = AsyncIterable<SDKMessage> & {
  interrupt(): Promise<unknown>
  close(): void
  supportedModels(): Promise<ModelInfo[]>
  setPermissionMode(mode: SessionPermissionMode): Promise<void>
  setModel(model?: string): Promise<void>
}

/** 可注入的 SDK 查询函数，参数与 SDK query() 一致。 */
export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options: Options
}) => AdapterQuery | Promise<AdapterQuery>

/** 适配器构造参数；所有外部依赖都可注入，便于不启动真实 CLI 的测试。 */
export type ClaudeAgentAdapterOptions = {
  queryFn?: QueryFn
  resolveBinaryPath?: () => string
  onEvent?: (event: SessionEvent) => void
  /** 一次性模型查询的有界等待时间；超时后关闭 query 并抛出可读错误。 */
  modelsTimeoutMs?: number
}

/** 开始一次会话的参数；binaryPath 省略时使用 PIGCLAUDE_CLAUDE_BIN 或平台包二进制。 */
export type ClaudeAgentStartOptions = {
  workspace: string
  env: Record<string, string>
  permissionMode: SessionPermissionMode
  canUseTool: CanUseTool
  abortController: AbortController
  binaryPath?: string
  model?: string
  thinking?: SessionThinking
  /** SDK 的 effort 档位；提供时优先于 thinking。 */
  effort?: SessionEffort
  /** 模型支持时启用快速模式。 */
  fast?: boolean
}

/** 查询模型列表的参数；env 由调用方提供，避免把宿主进程的凭据带进子进程。 */
export type ClaudeModelsOptions = {
  workspace?: string
  env?: Record<string, string>
  binaryPath?: string
}

/** 包装 SDK query 的会话适配器。保证同一实例只开始一次会话，停止和并发中断可安全重复调用。 */
export class ClaudeAgentAdapter {
  readonly #queryFn: QueryFn
  readonly #resolveBinaryPath: () => string
  readonly #onEvent: ((event: SessionEvent) => void) | undefined
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
    const prompt = new PromptStream()
    const abortController = new AbortController()
    const sdkOptions: Options = {
      cwd: options.workspace ?? process.cwd(),
      pathToClaudeCodeExecutable: options.binaryPath ?? this.#resolveBinaryPath(),
      env: { ...options.env },
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      permissionMode: "default",
      abortController,
    }
    let query: AdapterQuery | null = null
    let creation: Promise<AdapterQuery> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        abortController.abort()
        reject(new Error(`MODEL_QUERY_TIMEOUT: 模型查询超时（${this.#modelsTimeoutMs} 毫秒）`))
      }, this.#modelsTimeoutMs)
    })
    try {
      creation = Promise.resolve(this.#queryFn({ prompt, options: sdkOptions }))
      query = await Promise.race([creation, timeout])
      const models = await Promise.race([query.supportedModels(), timeout])
      return mergeClaudeModels(models)
    } finally {
      if (timer !== null) clearTimeout(timer)
      prompt.end()
      abortController.abort()
      closeModelQuery(query, creation)
    }
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
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.#emit({
            type: "started",
            sessionId: message.session_id,
            model: message.model,
            tools: [...message.tools],
            permissionMode: message.permissionMode,
          })
        }
        return
      case "stream_event":
        this.#handleStreamEvent(message.event)
        return
      case "assistant": {
        this.#emit({
          type: "message",
          messageId: message.message.id,
          model: message.message.model,
          parentToolUseId: message.parent_tool_use_id,
          blocks: mapContentBlocks(message.message.content),
        })
        if (message.error !== undefined) {
          this.#emit({
            type: "error",
            code: "SDK_ERROR",
            message: `assistant error: ${message.error}`,
          })
        }
        return
      }
      case "user":
        this.#handleToolResults(message.message.content)
        return
      case "result":
        this.#emit({
          type: "result",
          subtype: message.subtype,
          isError: message.is_error,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
          stopReason: message.stop_reason,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadTokens: message.usage.cache_read_input_tokens,
            cacheCreationTokens: message.usage.cache_creation_input_tokens,
          },
        })
        return
      default:
        return
    }
  }

  #handleStreamEvent(event: unknown): void {
    if (!isRecord(event) || event.type !== "content_block_delta") return
    const delta = event.delta
    if (!isRecord(delta)) return
    const blockIndex = typeof event.index === "number" ? event.index : 0
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      this.#emit({ type: "delta", text: delta.text, thinking: false, blockIndex })
    } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      this.#emit({ type: "delta", text: delta.thinking, thinking: true, blockIndex })
    }
  }

  #handleToolResults(content: unknown): void {
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (!isRecord(block) || block.type !== "tool_result") continue
      if (typeof block.tool_use_id !== "string") continue
      this.#emit({
        type: "tool-result",
        toolUseId: block.tool_use_id,
        content: toolResultText(block.content),
        isError: block.is_error === true,
      })
    }
  }

  #emit(event: SessionEvent): void {
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

// 一次性查询结束：已拿到的 query 立即关闭；还在创建的 query 在返回后立刻关闭，避免遗留进程。
function closeModelQuery(query: AdapterQuery | null, creation: Promise<AdapterQuery> | null): void {
  if (query !== null) {
    closeQuietly(query)
    return
  }
  if (creation === null) return
  void creation.then(closeQuietly, () => undefined)
}

function closeQuietly(query: AdapterQuery): void {
  try {
    query.close()
  } catch {
    // SDK 进程可能已经退出，关闭失败不影响超时或结果。
  }
}

function buildQueryOptions(options: ClaudeAgentStartOptions, binaryPath: string): Options {
  return {
    cwd: options.workspace,
    pathToClaudeCodeExecutable: binaryPath,
    env: { ...options.env },
    settingSources: [],
    persistSession: false,
    includePartialMessages: true,
    permissionMode: options.permissionMode,
    canUseTool: options.canUseTool,
    abortController: options.abortController,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.effort !== undefined
      ? { effort: options.effort }
      : options.thinking === undefined
        ? {}
        : { thinking: thinkingConfig(options.thinking) }),
    ...(options.fast ? { settings: { fastMode: true } } : {}),
    ...(options.permissionMode === "bypassPermissions"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
  }
}

// 固定档位映射，避免 renderer 直接传任意 token 预算。
function thinkingConfig(thinking: SessionThinking): ThinkingConfig {
  switch (thinking) {
    case "off":
      return { type: "disabled" }
    case "low":
      return { type: "enabled", budgetTokens: 2_048 }
    case "medium":
      return { type: "enabled", budgetTokens: 8_192 }
    case "high":
      return { type: "enabled", budgetTokens: 16_384 }
  }
}

function mapContentBlocks(content: unknown): SessionContentBlock[] {
  if (!Array.isArray(content)) return []
  const blocks: SessionContentBlock[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text })
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      blocks.push({ type: "thinking", text: block.thinking })
    } else if (block.type === "tool_use" && typeof block.id === "string") {
      blocks.push({
        type: "tool-use",
        id: block.id,
        name: typeof block.name === "string" ? block.name : "unknown",
        input: block.input,
      })
    }
  }
  return blocks
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text)
    }
  }
  return parts.join("")
}

const defaultQueryFn: QueryFn = async ({ prompt, options }) => {
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  return sdk.query({ prompt, options })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 单消费者的异步 prompt 流；send 写入，stop 结束并把等待者全部释放。
class PromptStream implements AsyncIterable<SDKUserMessage> {
  #values: SDKUserMessage[] = []
  #waiters: ((result: IteratorResult<SDKUserMessage>) => void)[] = []
  #ended = false

  push(message: SDKUserMessage): void {
    if (this.#ended) throw new Error("session prompt stream is closed")
    const waiter = this.#waiters.shift()
    if (waiter === undefined) this.#values.push(message)
    else waiter({ done: false, value: message })
  }

  end(): void {
    if (this.#ended) return
    this.#ended = true
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined })
  }

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
