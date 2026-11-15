// 按插件版本和网络出口管理独立实例，同一实例串行调用，空闲或崩溃后安全回收。
import {
  pluginSandboxKey,
  PluginSandboxError,
  type PluginSandboxCall,
  type PluginSandboxCallOptions,
  type PluginSandboxJson,
  type PluginSandboxNetwork,
  type PluginSandboxSource,
} from "./plugin-sandbox-contract"

/** 一个已经完成启动验证的上下文，关闭后不能执行更多调用。 */
export type PluginSandboxContext = {
  invoke(
    call: PluginSandboxCall,
    timeoutMs: number,
    signal: AbortSignal,
    network?: PluginSandboxNetwork,
  ): Promise<PluginSandboxJson>
  close(): Promise<void>
}

/** 装配专用上下文；启动失败须自行清理，启动完成后的崩溃通过 crashed 回报。 */
export type PluginSandboxLaunch = (
  source: PluginSandboxSource,
  crashed: () => void,
  signal: AbortSignal,
) => Promise<PluginSandboxContext>

/** 生命周期计时，默认空闲一分钟回收，崩溃从一秒开始退避。 */
export type PluginSandboxHostOptions = { idleMs?: number; restartDelayMs?: number }

type Instance = {
  pluginId: string
  abort: AbortController
  queue: Promise<void>
  users: number
  failures: number
  retryAt: number
  generation: symbol | null
  context: PluginSandboxContext | null
  idle: ReturnType<typeof setTimeout> | undefined
}

const callTimeoutMs = 15_000
const maximumTimeoutMs = 120_000

/** 管理插件实例生命周期，异常调用不会拖住其他插件或其他网络出口。 */
export class PluginSandboxHost {
  readonly #entries = new Map<string, Instance>()
  readonly #shutdown = new AbortController()
  readonly #closing = new Set<Promise<void>>()
  readonly #stopping = new Set<Promise<void>>()
  readonly #idleMs: number
  readonly #restartDelayMs: number
  #disposing: Promise<void> | undefined

  /** 保存用于启动经过隔离验证的上下文工厂。 */
  constructor(
    private readonly launch: PluginSandboxLaunch,
    options: PluginSandboxHostOptions = {},
  ) {
    this.#idleMs = options.idleMs ?? 60_000
    this.#restartDelayMs = options.restartDelayMs ?? 1_000
  }

  /** 执行一次插件操作，按安装版本与出口隔离；崩溃的操作不会被重放。 */
  async invoke(
    source: PluginSandboxSource,
    call: PluginSandboxCall,
    options: PluginSandboxCallOptions = {},
  ): Promise<PluginSandboxJson> {
    if (this.#shutdown.signal.aborted) throw new PluginSandboxError("PLUGIN_SANDBOX_CLOSED")
    if (options.signal?.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
    const timeout = options.timeoutMs ?? callTimeoutMs
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > maximumTimeoutMs)
      throw new PluginSandboxError("PLUGIN_PAYLOAD_INVALID")
    const key = pluginSandboxKey(source)
    const entry = this.#entry(key, source.pluginId)
    const signals = [this.#shutdown.signal, entry.abort.signal]
    if (options.signal) signals.push(options.signal)
    const signal = AbortSignal.any(signals)
    clearTimeout(entry.idle)
    entry.users += 1
    const work = entry.queue
      .then(() => this.#call(entry, source, call, timeout, signal))
      .finally(() => {
        entry.users -= 1
        if (entry.users === 0 && this.#entries.get(key) === entry && !this.#shutdown.signal.aborted)
          this.#startIdleTimer(key, entry)
      })
    entry.queue = work.then(
      () => undefined,
      () => undefined,
    )
    return cancellable(work, signal)
  }

  /** 中止排队和执行中的调用，释放所有当前及正在启动的上下文。 */
  dispose(): Promise<void> {
    if (this.#disposing !== undefined) return this.#disposing
    this.#shutdown.abort()
    this.#disposing = this.stopInstances()
    return this.#disposing
  }

  /** 中止并释放指定插件的各个出口实例；未指定时释放当前全部实例。 */
  stopInstances(pluginId?: string): Promise<void> {
    const entries: Instance[] = []
    for (const [key, entry] of this.#entries) {
      if (pluginId !== undefined && entry.pluginId !== pluginId) continue
      this.#entries.delete(key)
      clearTimeout(entry.idle)
      entries.push(entry)
    }
    const draining = entries.map(async (entry) => {
      await entry.queue
      await this.#close(entry)
    })
    const stopped = Promise.all([...this.#stopping, ...draining]).then(async () => {
      await Promise.all(this.#closing)
    })
    this.#stopping.add(stopped)
    void stopped.then(() => this.#stopping.delete(stopped))
    for (const entry of entries) entry.abort.abort()
    return stopped
  }

  #entry(key: string, pluginId: string): Instance {
    const existing = this.#entries.get(key)
    if (existing) return existing
    const entry: Instance = {
      pluginId,
      abort: new AbortController(),
      queue: Promise.resolve(),
      users: 0,
      failures: 0,
      retryAt: 0,
      generation: null,
      context: null,
      idle: undefined,
    }
    this.#entries.set(key, entry)
    return entry
  }

  async #call(
    entry: Instance,
    source: PluginSandboxSource,
    call: PluginSandboxCall,
    timeout: number,
    signal: AbortSignal,
  ): Promise<PluginSandboxJson> {
    if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
    if (Date.now() < entry.retryAt) throw new PluginSandboxError("PLUGIN_SANDBOX_BACKOFF")
    try {
      const context = entry.context ?? (await this.#open(entry, source, signal))
      const value = await context.invoke(call, timeout, signal, source.network)
      entry.failures = 0
      return value
    } catch (error) {
      if (!(error instanceof PluginSandboxError)) {
        this.#backOff(entry)
        await this.#close(entry)
        throw new PluginSandboxError("PLUGIN_SANDBOX_CRASHED")
      }
      if (error.code === "PLUGIN_TIMEOUT" || error.code === "PLUGIN_CANCELLED") {
        await this.#close(entry)
      } else if (error.code === "PLUGIN_LOAD_FAILED" || error.code === "PLUGIN_SANDBOX_CRASHED") {
        if (entry.generation !== null) this.#backOff(entry)
        await this.#close(entry)
      }
      throw error
    }
  }

  async #open(
    entry: Instance,
    source: PluginSandboxSource,
    signal: AbortSignal,
  ): Promise<PluginSandboxContext> {
    const generation = Symbol()
    entry.generation = generation
    const context = await this.launch(
      source,
      () => {
        if (entry.generation !== generation) return
        this.#backOff(entry)
        void this.#close(entry)
      },
      signal,
    )
    if (entry.generation !== generation || signal.aborted) {
      await context.close().catch(() => undefined)
      throw new PluginSandboxError(signal.aborted ? "PLUGIN_CANCELLED" : "PLUGIN_SANDBOX_CRASHED")
    }
    entry.context = context
    return context
  }

  #backOff(entry: Instance): void {
    const delay = Math.min(30_000, this.#restartDelayMs * 2 ** Math.min(entry.failures, 10))
    entry.failures += 1
    entry.retryAt = Date.now() + delay
  }

  #startIdleTimer(key: string, entry: Instance): void {
    const delay = Math.max(this.#idleMs, entry.retryAt - Date.now())
    entry.idle = setTimeout(() => {
      if (this.#entries.get(key) !== entry) return
      this.#entries.delete(key)
      void this.#close(entry)
    }, delay)
    entry.idle.unref()
  }

  #close(entry: Instance): Promise<void> {
    const context = entry.context
    entry.context = null
    entry.generation = null
    if (context === null) return Promise.resolve()
    const closing = Promise.resolve()
      .then(() => context.close())
      .catch(() => undefined)
    this.#closing.add(closing)
    void closing.then(() => this.#closing.delete(closing))
    return closing
  }
}

function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new PluginSandboxError("PLUGIN_CANCELLED"))
    signal.addEventListener("abort", abort, { once: true })
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
    if (signal.aborted) abort()
  })
}
