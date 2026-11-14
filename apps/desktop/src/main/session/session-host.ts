// 负责编排一个窗口里的全部 Claude 会话：注册表加并发名额，启动、把命令交给对应的 ClaudeSession、停放、
// 会员失效、模型目录和事件广播。每个会话的运行在 ClaudeSession，排队和空闲停放在 SessionConcurrency。
import { randomUUID } from "node:crypto"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { readOrganizationModels, type OrganizationModelReader } from "./claude-bootstrap"
import type { ClaudeSession } from "./claude-session"
import type { DevProviderOverride } from "./dev-provider"
import type { PermissionAnswer } from "./permission-broker"
import type { QuestionAnswer } from "./question-broker"
import { SessionConcurrency, defaultSessionLimits } from "./session-concurrency"
import { hostEnvelope, type SessionEnvelope } from "./session-envelope"
import { SessionEnvironment } from "./session-environment"
import type { ActiveSession, SessionTimers } from "./session-host-active"
import { pinnedCatalog } from "./session-host-provider"
import { assertMembershipActive, type SessionPendingWork } from "./session-host-support"
import { launchSession, type SessionLaunchDeps, type SessionLaunchHooks } from "./session-launch"
import { queryModels } from "./session-models"
import { SessionRegistry, type SessionEntry, type SessionParkReason } from "./session-registry"
import type { SessionSummary } from "./session-summary"
import type {
  SessionAdapterFactory,
  SessionEnvironmentFactory,
  SessionHostEvent,
  SessionMembership,
  SessionModelCatalog,
  SessionPermissionMode,
  SessionProfile,
  SessionRuntime,
  SessionSendInput,
  SessionStartInput,
  SessionStatusView,
  SessionTools,
  SessionUsagePort,
} from "./session-types"
import { SessionHostError } from "./session-types"

/** SessionHost 依赖；所有外部端口都可注入，便于不启动真实 CLI 的测试。 */
export type SessionHostOptions = {
  membership: SessionMembership
  runtime: SessionRuntime
  usage: SessionUsagePort
  userDataPath: string
  createEnvironment?: SessionEnvironmentFactory
  createAdapter?: SessionAdapterFactory
  resolveBinaryPath?: () => string
  resolveProfile?: (accountId: string | null) => Promise<SessionProfile | null>
  /** 经 daemon 读当次选中账号的组织模型；缺省时用随包 CLI 的 bootstrap 请求。 */
  readOrganizationModels?: OrganizationModelReader
  /** 开发期自定义供应商；只由主进程在未打包时传入，不影响会员和账号门禁。 */
  provider?: DevProviderOverride | null
  defaultWorkspace?: () => string
  permissionTimeoutMs?: number
  /** 同时运行的 Claude Code 进程上限，默认 4。 */
  maxRunningSessions?: number
  /** 等名额的会话上限，默认 8。 */
  maxQueuedSessions?: number
  /** 空闲多久自动停放，默认 30 分钟。 */
  idleParkMs?: number
  timers?: SessionTimers
  now?: () => number
  newId?: () => string
}

const usageWriteFailed = "用量记录写入失败"
const realTimers: SessionTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle),
}
const parkMessages: Record<SessionParkReason, string> = {
  stop: "会话已停止",
  idle: "会话已停放",
  membership: "会员状态已失效",
}

/** 多会话宿主。保证同一个会话 id 只启动一次；运行的进程数不超过上限；停放的会话仍可补拉事件；启动失败不留半启动环境。 */
export class SessionHost {
  readonly #membership: SessionMembership
  readonly #readOrganizationModels: OrganizationModelReader
  readonly #defaultWorkspace: () => string
  readonly #now: () => number
  readonly #newId: () => string
  readonly #launchDeps: SessionLaunchDeps
  readonly #registry = new SessionRegistry()
  readonly #concurrency: SessionConcurrency
  readonly #listeners = new Set<(envelope: SessionEnvelope) => void>()
  readonly #unsubscribe: (() => void)[]
  #checkingStart = Promise.resolve()
  #disposed = false

  /** 创建会话宿主并订阅会员、换号和用量写入失败事件。 */
  constructor(options: SessionHostOptions) {
    this.#membership = options.membership
    this.#readOrganizationModels = options.readOrganizationModels ?? readOrganizationModels
    this.#defaultWorkspace = options.defaultWorkspace ?? (() => process.cwd())
    this.#now = options.now ?? Date.now
    this.#newId = options.newId ?? (() => randomUUID())
    const timers = options.timers ?? realTimers
    this.#launchDeps = {
      membership: options.membership,
      runtime: options.runtime,
      provider: options.provider ?? null,
      createEnvironment: options.createEnvironment ?? ((input) => SessionEnvironment.create(input)),
      createAdapter: options.createAdapter ?? ((onEvent) => new ClaudeAgentAdapter({ onEvent })),
      resolveBinaryPath: options.resolveBinaryPath ?? (() => resolveClaudeBinaryPath()),
      resolveProfile: options.resolveProfile ?? (async () => null),
      userDataPath: options.userDataPath,
      usage: options.usage,
      permissionTimeoutMs: options.permissionTimeoutMs ?? 10 * 60 * 1_000,
      timers,
      now: this.#now,
      newId: this.#newId,
    }
    this.#concurrency = new SessionConcurrency({
      maxRunning: options.maxRunningSessions ?? defaultSessionLimits.maxRunning,
      maxQueued: options.maxQueuedSessions ?? defaultSessionLimits.maxQueued,
      idleParkMs: options.idleParkMs ?? defaultSessionLimits.idleParkMs,
      now: this.#now,
      timers,
      isIdle: (sessionId) => this.#registry.isIdle(sessionId),
      evictable: (sessionId) => this.#registry.evictable(sessionId),
      lastActivityAt: (sessionId) => this.#registry.get(sessionId)?.lastActivityAt ?? 0,
      park: (sessionId) => {
        const entry = this.#registry.get(sessionId)
        if (entry !== null) void this.#park(entry, "idle")
      },
    })
    this.#unsubscribe = [
      options.usage.onWriteFailed(() => {
        this.#emitHost({ type: "error", code: "usage_write_failed", message: usageWriteFailed })
      }),
      options.membership.subscribe((view) => {
        if (view.state !== "active") void this.#handleMembershipLost()
      }),
      options.runtime.subscribe((event) =>
        this.#registry.live(event.sessionId)?.applyAccountSwitch(event),
      ),
    ]
  }

  /** 订阅脱敏会话事件的信封，返回取消订阅函数。 */
  subscribe(listener: (envelope: SessionEnvelope) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * 启动一个会话，Claude Code 启动完成后返回它的 id。进程名额已满时先停放最久没用的空闲会话，还不够就排队，
   * 排队期间会话在列表里显示为排队；排满时抛 SESSION_LIMIT_REACHED。input.sessionId 指向正在排队、启动或运行的
   * 会话时返回同一个 id，指向停放的会话时抛 SESSION_RESUME_FAILED。会员、工作区、可用账号或 daemon 不满足时不创建任何环境。
   */
  async start(input: SessionStartInput, tools?: SessionTools): Promise<{ sessionId: string }> {
    if (this.#disposed) throw new SessionHostError("SDK_ERROR", "会话宿主已关闭")
    const existing = input.sessionId === undefined ? null : this.#registry.get(input.sessionId)
    if (existing !== null) {
      tools?.close()
      if (existing.phase === "parked") throw resumeFailed()
      return existing.launch ?? { sessionId: existing.sessionId }
    }
    const entry = this.#registry.add(input.sessionId ?? this.#newId(), input.workspace, this.#now())
    entry.closeTools = tools?.close ?? null
    const launch = this.#launch(entry, input, tools?.servers)
    entry.launch = launch
    try {
      return await launch
    } finally {
      entry.launch = null
    }
  }

  async #launch(
    entry: SessionEntry,
    input: SessionStartInput,
    servers: SessionTools["servers"],
  ): Promise<{ sessionId: string }> {
    try {
      const hooks: SessionLaunchHooks = {
        cancelled: () => entry.cancelled ?? (this.#disposed ? "SESSION_CANCELLED" : null),
        acquire: () => {
          entry.phase = "queued"
          const slot = this.#concurrency.acquire(entry.sessionId)
          this.#emitHost({ type: "sessions-changed" })
          return slot.then((waited) => {
            entry.phase = "starting"
            this.#emitHost({ type: "sessions-changed" })
            return waited
          })
        },
        checkBeforeQueue: (check) => {
          const checked = this.#checkingStart.then(check)
          this.#checkingStart = checked.then(
            () => undefined,
            () => undefined,
          )
          return checked
        },
        opened: (session, canonicalWorkspace) => {
          entry.session = session
          entry.canonicalWorkspace = canonicalWorkspace
        },
        emit: (envelope) => this.#observe(entry, envelope),
        backgroundTasks: (count) => {
          entry.backgroundTasks = count
          this.#concurrency.touch(entry.sessionId)
        },
        released: () => this.#released(entry),
      }
      await launchSession(this.#launchDeps, input, entry.sessionId, hooks, servers)
    } catch (error) {
      this.#forget(entry)
      throw error
    }
    entry.phase = "running"
    this.#concurrency.touch(entry.sessionId)
    this.#emitHost({ type: "sessions-changed" })
    return { sessionId: entry.sessionId }
  }

  /** 向指定会话写入一条消息；如有工作台回调，在交给适配器之前记录基线。回合未结束时抛 TURN_ACTIVE。 */
  async send(
    sessionId: string,
    input: SessionSendInput,
    checkpoint?: ActiveSession["checkpoint"],
  ): Promise<void> {
    await this.#requireSession(sessionId).send(input, checkpoint)
  }

  /** 取消指定会话的当前 turn：立即拒绝未回答权限并中断，但保留会话供下一次发送。不是运行中的会话时什么也不做。 */
  async cancel(sessionId: string): Promise<void> {
    await this.#registry.live(sessionId)?.cancel()
  }

  /** 写回指定会话的一次权限回答；未知会话或未知 requestId 都忽略。 */
  async respondPermission(sessionId: string, answer: PermissionAnswer): Promise<void> {
    this.#registry.live(sessionId)?.respondPermission(answer)
  }

  /**
   * 写回指定会话的一次提问回答；未知会话或未知 requestId 都忽略。会员无效时抛 MEMBERSHIP_REQUIRED，
   * 答案条数和问题数不一致时抛 INVALID_SESSION_INPUT。
   */
  answerQuestion(sessionId: string, answer: QuestionAnswer): void {
    this.#assertMembership()
    this.#registry.live(sessionId)?.answerQuestion(answer)
  }

  /** 切换后续工具调用的权限模式；等待中的权限请求保持原模式。自动审批被拒时不抛错，改发提示。 */
  async setMode(sessionId: string, mode: SessionPermissionMode): Promise<void> {
    await this.#requireSession(sessionId).setMode(mode)
  }

  /** 切换后续回复使用的模型；不影响已发出的请求。开发期供应商固定模型时不接受其他取值。 */
  async setModel(sessionId: string, model: string): Promise<void> {
    await this.#requireSession(sessionId).setModel(model)
  }

  /**
   * 按序号补拉指定会话要保存的事件，按序号排列，一次有上限；停放的会话仍可读。
   * 会员无效时抛 MEMBERSHIP_REQUIRED，会话不存在或还在排队时抛 SESSION_NOT_FOUND。
   */
  events(sessionId: string, afterSeq: number): SessionEnvelope[] {
    this.#assertMembership()
    const session = this.#registry.get(sessionId)?.session ?? null
    if (session === null) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
    return session.events(afterSeq)
  }

  /**
   * 停放会话：先拒绝未回答权限，再中断、停止适配器、吊销令牌并释放环境，会话留在列表里；可重复调用。
   * 排队或正在启动的会话被取消，它的 start 抛 SESSION_CANCELLED。不带会话 id 时停放全部会话。
   */
  async stop(sessionId?: string): Promise<void> {
    const entries = sessionId === undefined ? this.#registry.all() : [this.#registry.get(sessionId)]
    await Promise.all(
      entries.map((entry) => (entry === null ? undefined : this.#halt(entry, "SESSION_CANCELLED"))),
    )
  }

  /** 查询模型目录；开发期供应商固定模型时直接返回单项目录。会员有效时列表不为空，降级时发一次提示。 */
  async models(): Promise<SessionModelCatalog> {
    await assertMembershipActive(this.#membership)
    const deps = this.#launchDeps
    const pinned = pinnedCatalog(deps.provider)
    if (pinned !== null) return { models: pinned, cliError: null }
    return queryModels({
      assertMembership: () => assertMembershipActive(this.#membership),
      runtime: deps.runtime,
      createEnvironment: deps.createEnvironment,
      createAdapter: deps.createAdapter,
      resolveProfile: deps.resolveProfile,
      readOrganizationModels: this.#readOrganizationModels,
      defaultWorkspace: this.#defaultWorkspace,
      resolveBinaryPath: deps.resolveBinaryPath,
      userDataPath: deps.userDataPath,
      newId: this.#newId,
      now: this.#now,
      notify: (message) => this.#emitHost({ type: "notice", message }),
    })
  }

  /**
   * 返回指定会话的脱敏快照；停放、排队的会话 active 为 false，会话不存在时抛 SESSION_NOT_FOUND。
   * 不带 id 时给最近启动、还在运行的会话，没有时所有 id 和模型为 null。
   */
  status(sessionId?: string): SessionStatusView {
    const view = this.#registry.status(sessionId)
    if (view === null) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
    return view
  }

  /** 列出全部会话（排队、运行中和停放）的脱敏摘要，最近活动的在前。会员无效时抛 MEMBERSHIP_REQUIRED。 */
  list(): SessionSummary[] {
    this.#assertMembership()
    return this.#registry.summaries()
  }

  /** 和这个工作区重叠的运行中会话里有没有进行中的回合；工作台据此拒绝切分支和恢复检查点。 */
  hasActiveTurn(workspace: string): boolean {
    return this.#registry.hasActiveTurn(workspace)
  }

  /** 退出前要确认的工作：所有会话进行中的回合和等待回答的权限；正在结束的会话不算。 */
  pendingWork(): SessionPendingWork {
    return this.#registry.pendingWork()
  }

  /** 停放全部会话并释放全部订阅；应用退出时调用。 */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    for (const unsubscribe of this.#unsubscribe) unsubscribe()
    await this.stop()
    this.#concurrency.dispose(new SessionHostError("SESSION_CANCELLED", "会话启动已取消"))
    this.#listeners.clear()
  }

  // 排队的取消；正在启动的打断（已有会话对象时结束它）并等启动收尾；运行中的停放。
  async #halt(
    entry: SessionEntry,
    code: "SESSION_CANCELLED" | "MEMBERSHIP_REQUIRED",
  ): Promise<void> {
    if (entry.phase === "checking" || entry.phase === "queued") {
      entry.cancelled = code
      this.#concurrency.cancel(entry.sessionId, cancelError(code))
      return
    }
    const reason: SessionParkReason = code === "MEMBERSHIP_REQUIRED" ? "membership" : "stop"
    if (entry.phase === "starting") {
      entry.cancelled = code
      const launch = entry.launch
      if (entry.session !== null) await this.#park(entry, reason)
      await launch?.catch(() => undefined)
      return
    }
    if (entry.phase === "running") await this.#park(entry, reason)
  }

  async #park(entry: SessionEntry, reason: SessionParkReason): Promise<void> {
    const session = entry.session
    if (session === null) return
    if (!session.closing) {
      entry.parkReason = reason
      entry.parkedMidTurn = session.status().turnId !== null
    }
    await session.end(parkMessages[reason], reason === "membership" ? "MEMBERSHIP_REQUIRED" : null)
  }

  async #handleMembershipLost(): Promise<void> {
    await Promise.all(this.#registry.all().map((entry) => this.#halt(entry, "MEMBERSHIP_REQUIRED")))
  }

  // 会话释放：交还名额、关掉会话专用的工具；运行中的会话转为停放，启动中的由启动流程收尾。
  #released(entry: SessionEntry): void {
    this.#closeTools(entry)
    if (entry.phase === "running") entry.phase = "parked"
    this.#concurrency.release(entry.sessionId)
    this.#emitHost({ type: "sessions-changed" })
  }

  #forget(entry: SessionEntry): void {
    this.#concurrency.release(entry.sessionId)
    this.#closeTools(entry)
    this.#registry.delete(entry)
    this.#emitHost({ type: "sessions-changed" })
  }

  #closeTools(entry: SessionEntry): void {
    const close = entry.closeTools
    entry.closeTools = null
    close?.()
  }

  #observe(entry: SessionEntry, envelope: SessionEnvelope): void {
    this.#registry.observe(entry, envelope, this.#now())
    this.#concurrency.touch(entry.sessionId)
    this.#emit(envelope)
  }

  #requireSession(sessionId: string): ClaudeSession {
    const entry = this.#registry.get(sessionId)
    if (entry === null) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
    if (entry.phase === "parked" || entry.session?.closing) throw resumeFailed()
    if (entry.phase !== "running" || entry.session === null) {
      throw new SessionHostError("SDK_ERROR", "会话尚未启动")
    }
    return entry.session
  }

  #assertMembership(): void {
    if (this.#membership.view().state !== "active") {
      throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
    }
  }

  #emitHost(event: SessionHostEvent): void {
    this.#emit(hostEnvelope(event, this.#now()))
  }

  #emit(envelope: SessionEnvelope): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(envelope)
      } catch {
        // 单个订阅者失败不能中断会话。
      }
    }
  }
}

function resumeFailed(): SessionHostError {
  return new SessionHostError("SESSION_RESUME_FAILED", "会话已停放，暂时不能接着使用")
}

function cancelError(code: "SESSION_CANCELLED" | "MEMBERSHIP_REQUIRED"): SessionHostError {
  return code === "MEMBERSHIP_REQUIRED"
    ? new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
    : new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
}
