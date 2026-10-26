// 负责按会员状态启动和停止本机 daemon，桥接账号选择、额度冷却和换号事件。
// 只监听 loopback；会员失效时停止 daemon 并中止正在进行的请求。

import { randomBytes } from "node:crypto"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { LocalStore } from "@pigclaude/local-store"
import { LocalDaemon } from "@pigclaude/daemon"
import type { AccountChooser, ChosenAccount } from "./account-chooser"

const defaultQuotaCooldownMs = 5 * 60 * 1_000
const defaultBackoffMs = [1_000, 2_000, 5_000, 10_000] as const

/** daemon 生命周期状态。starting 也表示尚未监听或正在重启。 */
export type LocalDaemonState = "starting" | "ready" | "failed"

/** runtime 的脱敏状态快照。保证不返回凭据、代理地址或会话令牌。 */
export type LocalRuntimeInspection = {
  daemon: LocalDaemonState
  accountCount: number
}

/** 运行时广播的换号事件。保证只含账号 id 和原因，不含凭据或代理地址。 */
export type LocalRuntimeEvent = {
  type: "account-switched"
  from: string | null
  to: string
  reason: "initial" | "switch" | "quota"
}

/** runtime 需要的会员端口。保证可以读取当前视图并订阅变化。 */
export type LocalRuntimeMembership = {
  view(): MembershipView
  subscribe(listener: (view: MembershipView) => void): () => void
}

/** daemon 实例的最小端口，便于测试注入。 */
export type LocalDaemonHandle = {
  port: number
  start(): Promise<void>
  stop(): Promise<void>
}

/** 创建 daemon 的参数，与 LocalDaemon 构造参数保持一致。 */
export type LocalDaemonOptions = {
  port: number
  sessionToken: string
  choose: (attempt: {
    rejectedIds: string[]
  }) => ChosenAccount | null | Promise<ChosenAccount | null>
  runAuthorized: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>
  onAccountRejected: (accountId: string, reason: string) => void
  onAccountSelected: (accountId: string, previousId: string | undefined) => void
  onExit: () => void
}

/** runtime 依赖。时间、退避、休眠和 daemon 工厂都可注入。 */
export type LocalRuntimeOptions = {
  store: Pick<LocalStore, "listAccounts" | "getAccount" | "saveAccount">
  chooser: Pick<AccountChooser, "choose" | "hasAvailableAccount">
  membership: LocalRuntimeMembership
  runAuthorized: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>
  sessionToken?: string
  now?: () => number
  quotaCooldownMs?: number
  backoffMs?: readonly number[]
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  createDaemon?: (options: LocalDaemonOptions) => LocalDaemonHandle
}

type Lifecycle = { abort: AbortController }

/** 本机 daemon 的生命周期和选号事件源。保证只在会员 active 时监听 loopback；启动失败按退避重试；会员失效或 stop 时中止请求并释放端口。 */
export class LocalRuntime {
  readonly sessionToken: string
  readonly chooser: Pick<AccountChooser, "choose" | "hasAvailableAccount">

  readonly #store: LocalRuntimeOptions["store"]
  readonly #membership: LocalRuntimeMembership
  readonly #authorized: LocalRuntimeOptions["runAuthorized"]
  readonly #now: () => number
  readonly #quotaCooldownMs: number
  readonly #backoffMs: readonly number[]
  readonly #sleep: NonNullable<LocalRuntimeOptions["sleep"]>
  readonly #createDaemon: NonNullable<LocalRuntimeOptions["createDaemon"]>
  readonly #listeners = new Set<(event: LocalRuntimeEvent) => void>()
  readonly #quotaRejections = new Set<string>()
  readonly #unsubscribe: () => void
  #daemon: LocalDaemonHandle | null = null
  #lifecycle: Lifecycle | null = null
  #starting: { promise: Promise<void> } | null = null
  #state: LocalDaemonState = "starting"
  #preferredId: string | null = null
  #currentAccountId: string | null = null
  #crashAttempts = 0
  #disposed = false

  /** 创建绑定会员、账号库和选号器的 runtime；构造时订阅会员变化但不会立即启动 daemon。 */
  constructor(options: LocalRuntimeOptions) {
    this.sessionToken = options.sessionToken ?? randomBytes(32).toString("base64url")
    this.chooser = options.chooser
    this.#store = options.store
    this.#membership = options.membership
    this.#authorized = options.runAuthorized
    this.#now = options.now ?? Date.now
    this.#quotaCooldownMs = options.quotaCooldownMs ?? defaultQuotaCooldownMs
    this.#backoffMs = options.backoffMs ?? defaultBackoffMs
    this.#sleep = options.sleep ?? delay
    this.#createDaemon = options.createDaemon ?? ((daemonOptions) => new LocalDaemon(daemonOptions))
    this.#unsubscribe = this.#membership.subscribe((view) => {
      if (view.state === "active") void this.start()
      else void this.stop()
    })
  }

  /** 只有 daemon 就绪时返回本机地址；未监听时返回 null。保证地址只指向 127.0.0.1。 */
  get daemonBaseUrl(): string | null {
    return this.#daemon === null ? null : `http://127.0.0.1:${this.#daemon.port}`
  }

  /** 会员 active 时启动 daemon；重复调用不会创建第二个实例。启动失败按退避重试，全部失败后状态为 failed。 */
  async start(): Promise<void> {
    if (this.#disposed || this.#membership.view().state !== "active") return
    if (this.#daemon !== null) return
    if (this.#starting !== null) return this.#starting.promise
    const lifecycle = this.#newLifecycle()
    const promise = this.#runStart(lifecycle).finally(() => {
      if (this.#starting?.promise === promise) this.#starting = null
    })
    this.#starting = { promise }
    return promise
  }

  /** 中止正在进行的请求并释放端口。保证之后可以再次 start，且 stop 不会抛出。 */
  async stop(): Promise<void> {
    const lifecycle = this.#lifecycle
    this.#lifecycle = null
    lifecycle?.abort.abort()
    const starting = this.#starting
    this.#starting = null
    const daemon = this.#daemon
    this.#daemon = null
    this.#state = "starting"
    if (starting !== null) await starting.promise.catch(() => undefined)
    if (daemon !== null) await daemon.stop().catch(() => undefined)
  }

  /** 停止 daemon、取消会员订阅并清空事件监听。保证重复调用安全。 */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribe()
    await this.stop()
    this.#listeners.clear()
  }

  /** 返回脱敏状态和已保存账号总数，不触发网络或 daemon 启动。 */
  async inspect(): Promise<LocalRuntimeInspection> {
    return {
      daemon: this.#state,
      accountCount: (await this.#store.listAccounts()).length,
    }
  }

  /** 不刷新凭据、不消耗额度地判断是否有可授权账号；读取失败按没有处理。 */
  async hasAvailableAccount(): Promise<boolean> {
    if (this.#disposed) return false
    try {
      return await this.chooser.hasAvailableAccount()
    } catch {
      return false
    }
  }

  /** 订阅换号事件，返回取消订阅函数。 */
  subscribe(listener: (event: LocalRuntimeEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 设置后续选号的偏好账号；只影响顺序，不绕过可用性过滤。 */
  setPreferredAccount(accountId: string | null): void {
    this.#preferredId = accountId
  }

  async #runStart(lifecycle: Lifecycle): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      if (!this.#isCurrent(lifecycle)) return
      this.#state = "starting"
      let pending: LocalDaemonHandle | null = null
      try {
        pending = this.#createDaemon(this.#daemonOptions(lifecycle))
        await pending.start()
      } catch {
        await stopQuietly(pending)
        if (!this.#isCurrent(lifecycle)) return
        const wait = this.#backoffMs[attempt]
        if (wait === undefined) {
          this.#state = "failed"
          return
        }
        await this.#sleep(wait, lifecycle.abort.signal)
        continue
      }
      if (!this.#isCurrent(lifecycle)) {
        await stopQuietly(pending)
        return
      }
      if (pending === null) continue
      this.#daemon = pending
      this.#state = "ready"
      this.#crashAttempts = 0
      return
    }
  }

  #daemonOptions(lifecycle: Lifecycle): LocalDaemonOptions {
    return {
      port: 0,
      sessionToken: this.sessionToken,
      choose: (attempt) =>
        this.chooser.choose({
          rejectedIds: attempt.rejectedIds,
          ...(this.#preferredId === null ? {} : { preferredId: this.#preferredId }),
        }),
      runAuthorized: <T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> =>
        this.#authorized((signal) => operation(AbortSignal.any([signal, lifecycle.abort.signal]))),
      onAccountRejected: (accountId, reason) => this.#handleRejected(accountId, reason),
      onAccountSelected: (accountId) => this.#handleSelected(accountId),
      onExit: () => this.#handleDaemonExit(lifecycle),
    }
  }

  #newLifecycle(): Lifecycle {
    this.#lifecycle?.abort.abort()
    const lifecycle: Lifecycle = { abort: new AbortController() }
    this.#lifecycle = lifecycle
    return lifecycle
  }

  #isCurrent(lifecycle: Lifecycle): boolean {
    return (
      !this.#disposed &&
      this.#lifecycle === lifecycle &&
      !lifecycle.abort.signal.aborted &&
      this.#membership.view().state === "active"
    )
  }

  #handleRejected(accountId: string, reason: string): void {
    if (reason !== "quota") return
    this.#quotaRejections.add(accountId)
    void this.#persistQuota(accountId).catch(() => undefined)
  }

  // 只处理当前生命周期的意外退出；主动 stop 时 LocalDaemon 不触发这个回调。
  #handleDaemonExit(lifecycle: Lifecycle): void {
    if (this.#lifecycle !== lifecycle || this.#daemon === null) return
    const daemon = this.#daemon
    this.#daemon = null
    this.#state = "starting"
    void daemon.stop().catch(() => undefined)
    const wait = this.#backoffMs[this.#crashAttempts]
    if (wait === undefined) {
      this.#state = "failed"
      return
    }
    this.#crashAttempts += 1
    const pending = this.#starting?.promise
    void (pending ?? Promise.resolve())
      .then(() => this.#sleep(wait, lifecycle.abort.signal))
      .then(() => {
        if (this.#lifecycle === lifecycle && !this.#disposed) return this.start()
        return undefined
      })
  }

  async #persistQuota(accountId: string): Promise<void> {
    const account = await this.#store.getAccount(accountId)
    if (account === null) return
    const exhaustedUntil = new Date(this.#now() + this.#quotaCooldownMs).toISOString()
    const existing = account.exhaustedUntil === null ? null : Date.parse(account.exhaustedUntil)
    if (existing !== null && Number.isFinite(existing) && existing >= Date.parse(exhaustedUntil))
      return
    await this.#store.saveAccount({
      ...account,
      exhaustedUntil,
      updatedAt: new Date(this.#now()).toISOString(),
    })
  }

  // 连续两次 choose 返回同一账号时不广播；跨请求换号用上一次实际选中的账号作为 from。
  #handleSelected(accountId: string): void {
    const from = this.#currentAccountId
    const reason =
      from !== null && this.#quotaRejections.has(from)
        ? "quota"
        : from === null
          ? "initial"
          : "switch"
    this.#quotaRejections.delete(accountId)
    if (from !== null) this.#quotaRejections.delete(from)
    this.#currentAccountId = accountId
    if (accountId === from) return
    this.#emit({ type: "account-switched", from, to: accountId, reason })
  }

  #emit(event: LocalRuntimeEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event)
      } catch {
        // 单个订阅者失败不能影响 daemon 的选号流程。
      }
    }
  }
}

async function stopQuietly(daemon: LocalDaemonHandle | null): Promise<void> {
  if (daemon === null) return
  await daemon.stop().catch(() => undefined)
}

// 等待退避时间；会员失效或 stop 时通过 signal 立即结束等待。
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener("abort", finish, { once: true })
  })
}
