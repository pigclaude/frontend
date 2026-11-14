// 提供 SessionHost 测试共用的假会员、runtime、会话环境、适配器和用量记录器；
// 不启动真实 Claude CLI、daemon 或网络。

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import type { MembershipState, MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeAgentStartOptions, ClaudeModelsOptions } from "./claude-agent-adapter"
import type { ClaudeModel, SessionEvent, SessionPermissionMode } from "./session-events"
import type { DevProviderOverride } from "./dev-provider"
import type { ModelAuth, SessionEnvironmentInput } from "./session-environment"
import type {
  SessionAdapterPort,
  SessionEnvironmentFactory,
  SessionEnvironmentPort,
  SessionHostEvent,
  SessionMembership,
  SessionRuntime,
  SessionProfile,
  SessionRuntimeEvent,
  SessionUsagePort,
} from "./session-types"
import type { UsageRecord, UsageSummary } from "./usage-recorder"
import { SessionHost, type SessionHostOptions } from "./session-host"

export const fixedNow = new Date(2026, 9, 26, 12, 0, 0).getTime()

/** 构造 SDK 转来的自动审批拒绝：消息是 CLI 原文，errorCode 是 CLI 的错误码。 */
export function autoModeRefusal(errorCode: string, reason: string): Error {
  return Object.assign(new Error(`Cannot set permission mode to auto: ${reason}`), { errorCode })
}

/** 构造一份脱敏会员视图；测试只关心状态。 */
export function membershipView(state: MembershipState = "active"): MembershipView {
  return {
    startupPhase: "settled",
    revision: 1,
    state,
    account: { userId: "user-1", nickname: "Pig", email: "pig@example.com", avatar: "" },
    tier: null,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: null,
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
  }
}

/** 可切换状态的假会员门禁。 */
export class FakeMembership implements SessionMembership {
  readonly #listeners = new Set<(view: MembershipView) => void>()
  #state: MembershipState

  constructor(state: MembershipState = "active") {
    this.#state = state
  }

  async inspect(): Promise<MembershipView> {
    return this.view()
  }

  view(): MembershipView {
    return membershipView(this.#state)
  }

  subscribe(listener: (view: MembershipView) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 模拟服务端会员状态变化并同步广播。 */
  setState(state: MembershipState): void {
    this.#state = state
    for (const listener of [...this.#listeners]) listener(this.view())
  }
}

/** 可注入换号事件和账号可用性的假 LocalRuntime。 */
export class FakeRuntime implements SessionRuntime {
  daemonBaseUrl: string | null
  readonly sessionToken = "runtime-session-token"
  preferredAccount: string | null | undefined = undefined
  availableAccounts = true
  beginSessionCalls = 0
  readonly #listeners = new Set<(event: SessionRuntimeEvent) => void>()

  constructor(daemonBaseUrl: string | null = "http://127.0.0.1:47821") {
    this.daemonBaseUrl = daemonBaseUrl
  }

  subscribe(listener: (event: SessionRuntimeEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  setPreferredAccount(accountId: string | null): void {
    this.preferredAccount = accountId
  }

  beginSession(): void {
    this.beginSessionCalls += 1
  }

  async hasAvailableAccount(): Promise<boolean> {
    return this.availableAccounts
  }

  /** 模拟 daemon 选号产生的换号事件。 */
  switchAccount(
    from: string | null,
    to: string,
    reason: SessionRuntimeEvent["reason"] = "switch",
  ): void {
    for (const listener of [...this.#listeners]) {
      listener({ type: "account-switched", from, to, reason })
    }
  }
}

/** 记录清理调用的假会话环境。 */
export class FakeEnvironment implements SessionEnvironmentPort {
  readonly env: Record<string, string>
  readonly configDir: string
  readonly sessionDir: string
  readonly workspace: string
  readonly binaryPath: string
  readonly timezone: string
  cleaned = 0
  readonly #trace: string[]

  constructor(input: SessionEnvironmentInput, trace: string[], userDataPath: string) {
    this.workspace = input.workspace
    this.binaryPath = input.binaryPath
    this.timezone = input.timezone
    this.sessionDir = `${input.userDataPath ?? userDataPath}/sessions/${input.sessionId}`
    this.configDir = `${this.sessionDir}/claude`
    this.env = { ANTHROPIC_BASE_URL: input.daemonBaseUrl }
    this.#trace = trace
  }

  async cleanup(): Promise<void> {
    this.cleaned += 1
    this.#trace.push("cleaned")
  }
}

/** 记录创建参数的假会话环境工厂。 */
export class EnvironmentFactory {
  readonly inputs: SessionEnvironmentInput[] = []
  readonly instances: FakeEnvironment[] = []

  constructor(
    private readonly trace: string[],
    private readonly userDataPath: string,
  ) {}

  readonly create: SessionEnvironmentFactory = async (input) => {
    this.inputs.push(input)
    const environment = new FakeEnvironment(input, this.trace, this.userDataPath)
    this.instances.push(environment)
    return environment
  }

  get last(): FakeEnvironment {
    const environment = this.instances.at(-1)
    if (environment === undefined) throw new Error("no environment was created")
    return environment
  }
}

/** 记录调用并允许手动广播 SDK 事件的假适配器。 */
export class FakeAdapter implements SessionAdapterPort {
  readonly startCalls: ClaudeAgentStartOptions[] = []
  readonly sent: string[] = []
  readonly modelCalls: ClaudeModelsOptions[] = []
  readonly modes: SessionPermissionMode[] = []
  readonly modelsSet: string[] = []
  modelsResult: ClaudeModel[] = [
    {
      id: "claude-sonnet-4",
      displayName: "Claude Sonnet 4",
      description: "Balanced",
      isDefault: false,
    },
  ]
  modelsError: Error | null = null
  canUseTool: CanUseTool | null = null
  interrupts = 0
  stops = 0
  /** 切到自动审批时抛出的错误，模拟 Claude Code 拒绝。 */
  autoRefusal: Error | null = null
  /** 任何模式切换都抛出的错误，模拟 CLI 已经不可用。 */
  modeError: Error | null = null
  /** 为 true 时模式变化通知晚于控制请求的回应到达。 */
  lateModeEvents = false
  readonly #onEvent: (event: SessionEvent) => void
  readonly #trace: string[]
  #startGate: { promise: Promise<void>; resolve: () => void } | null = null
  #mode: SessionPermissionMode = "default"

  constructor(onEvent: (event: SessionEvent) => void, trace: string[]) {
    this.#onEvent = onEvent
    this.#trace = trace
  }

  async start(options: ClaudeAgentStartOptions): Promise<void> {
    this.startCalls.push(options)
    this.canUseTool = options.canUseTool
    this.#mode = options.permissionMode
    this.#trace.push("started")
    if (this.#startGate !== null) await this.#startGate.promise
  }

  /** 让下一次 start 停在返回前，用于验证启动期间的停止请求。 */
  holdStart(): void {
    let resolve: () => void = () => undefined
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    this.#startGate = { promise, resolve }
  }

  /** 释放被 holdStart 暂停的启动。 */
  releaseStart(): void {
    const gate = this.#startGate
    this.#startGate = null
    gate?.resolve()
  }

  async send(text: string): Promise<void> {
    this.sent.push(text)
  }

  async interrupt(): Promise<void> {
    await Promise.resolve()
    this.interrupts += 1
    this.#trace.push("interrupted")
  }

  async stop(): Promise<void> {
    this.stops += 1
    this.#trace.push("stopped")
    this.#onEvent({ type: "ended", reason: "stopped" })
  }

  async models(options: ClaudeModelsOptions = {}): Promise<ClaudeModel[]> {
    this.modelCalls.push(options)
    if (this.modelsError !== null) throw this.modelsError
    return this.modelsResult
  }

  /** 和 CLI 一样：被拒时模式不变，真正变化时发一条模式通知。 */
  async setPermissionMode(mode: SessionPermissionMode): Promise<void> {
    this.modes.push(mode)
    if (mode === "auto" && this.autoRefusal !== null) throw this.autoRefusal
    if (this.modeError !== null) throw this.modeError
    if (mode === this.#mode) return
    this.#mode = mode
    const event: SessionEvent = { type: "mode", permissionMode: mode }
    if (this.lateModeEvents) setTimeout(() => this.#onEvent(event), 0)
    else this.#onEvent(event)
  }

  async setModel(model: string): Promise<void> {
    this.modelsSet.push(model)
  }

  /** 把一条 SDK 事件推给 SessionHost。 */
  emit(event: SessionEvent): void {
    this.#onEvent(event)
  }
}

/** 记录创建参数的假适配器工厂。 */
export class AdapterFactory {
  readonly instances: FakeAdapter[] = []
  #configure: ((adapter: FakeAdapter) => void) | null = null

  constructor(
    private readonly trace: string[],
    private readonly holdStart = false,
    private readonly modelsError: Error | null = null,
  ) {}

  readonly create = (onEvent: (event: SessionEvent) => void): SessionAdapterPort => {
    const adapter = new FakeAdapter(onEvent, this.trace)
    adapter.modelsError = this.modelsError
    if (this.holdStart) adapter.holdStart()
    this.#configure?.(adapter)
    this.instances.push(adapter)
    return adapter
  }

  /** 之后新建的适配器在启动前先交给 configure，便于设置拒绝或失败。 */
  onCreate(configure: (adapter: FakeAdapter) => void): void {
    this.#configure = configure
  }

  get last(): FakeAdapter {
    const adapter = this.instances.at(-1)
    if (adapter === undefined) throw new Error("no adapter was created")
    return adapter
  }
}

/** 默认不写入任何内容、可手动触发失败的假用量记录器。 */
export class FakeUsage implements SessionUsagePort {
  readonly records: UsageRecord[] = []
  readonly #failures = new Set<(message: string) => void>()

  async record(record: UsageRecord): Promise<void> {
    this.records.push(record)
  }

  async summary(): Promise<UsageSummary> {
    return {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      averageDurationMs: 0,
      errors: 0,
    }
  }

  onWriteFailed(listener: (message: string) => void): () => void {
    this.#failures.add(listener)
    return () => this.#failures.delete(listener)
  }

  /** 模拟一次用量写入失败。 */
  failWrite(message: string): void {
    for (const listener of [...this.#failures]) listener(message)
  }
}

export type HarnessOptions = {
  workspace: string
  membershipState?: MembershipState
  daemonBaseUrl?: string | null
  userDataPath?: string
  useRealEnvironment?: boolean
  permissionTimeoutMs?: number
  holdAdapterStart?: boolean
  resolveBinaryPath?: () => string
  resolveProfile?: SessionProfile
  resolveModelAuth?: ModelAuth | null
  modelsError?: Error
  provider?: DevProviderOverride
}

export type SessionHarness = {
  host: SessionHost
  membership: FakeMembership
  runtime: FakeRuntime
  usage: FakeUsage
  adapters: AdapterFactory
  environments: EnvironmentFactory
  events: SessionHostEvent[]
  trace: string[]
  workspace: string
  userDataPath: string
}

/** 组装一个全部依赖都可注入的 SessionHost。 */
export function createHarness(options: HarnessOptions): SessionHarness {
  const trace: string[] = []
  const membership = new FakeMembership(options.membershipState ?? "active")
  const runtime = new FakeRuntime(
    options.daemonBaseUrl === undefined ? "http://127.0.0.1:47821" : options.daemonBaseUrl,
  )
  const usage = new FakeUsage()
  const adapters = new AdapterFactory(
    trace,
    options.holdAdapterStart ?? false,
    options.modelsError ?? null,
  )
  const userDataPath = options.userDataPath ?? "/tmp/pigclaude-session-host-user-data"
  const environments = new EnvironmentFactory(trace, userDataPath)
  const events: SessionHostEvent[] = []
  let nextId = 0
  const hostOptions: SessionHostOptions = {
    membership,
    runtime,
    usage,
    userDataPath,
    createAdapter: adapters.create,
    resolveBinaryPath: options.resolveBinaryPath ?? (() => "/fake/claude"),
    resolveProfile: async () =>
      options.resolveProfile ?? { timezone: "America/Los_Angeles", locale: "en-US" },
    resolveModelAuth: async () => options.resolveModelAuth ?? null,
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    defaultWorkspace: () => options.workspace,
    permissionTimeoutMs: options.permissionTimeoutMs ?? 10 * 60 * 1_000,
    now: () => fixedNow,
    newId: () => `id-${(nextId += 1)}`,
    ...(options.useRealEnvironment ? {} : { createEnvironment: environments.create }),
  }
  const host = new SessionHost(hostOptions)
  host.subscribe((event) => events.push(event))
  return {
    host,
    membership,
    runtime,
    usage,
    adapters,
    environments,
    events,
    trace,
    workspace: options.workspace,
    userDataPath,
  }
}

/** 等待异步广播条件成立，避免固定延时。 */
export async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("condition was not reached")
}
