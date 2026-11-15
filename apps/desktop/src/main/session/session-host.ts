// 负责一个窗口内的 Claude 会话启动、并发名额、命令路由、停放和历史管理。
import { randomUUID } from "node:crypto"
import type { OrganizationModelReader } from "./claude-bootstrap"
import type { ClaudeSession } from "./claude-session"
import type { DevProviderOverride } from "./dev-provider"
import type { PermissionAnswer } from "./permission-broker"
import type { QuestionAnswer } from "./question-broker"
import { SessionConcurrency, defaultSessionLimits } from "./session-concurrency"
import { SessionClaudeExitError } from "./session-claude-launch"
import { hostEnvelope, notifySessionListeners, type SessionEnvelope } from "./session-envelope"
import type { ActiveSession, SessionTimers } from "./session-host-active"
import type { SessionPendingWork } from "./session-host-support"
import {
  createSessionLaunchDeps,
  launchSession,
  orderedSessionChecks,
  sessionLaunchCancellation,
  type SessionLaunchDeps,
  type SessionLaunchHooks,
  type SessionLaunchStorage,
} from "./session-launch"
import {
  checkFreshSessionId,
  resumeSavedSession,
  rollbackSavedLaunch,
  SessionPersistence,
} from "./session-persistence"
import { SavedSessionLibrary } from "./saved-session-library"
import type { SessionStore } from "./session-store"
import { sessionModelReader } from "./session-models"
import { SessionRegistry, type SessionEntry, type SessionParkReason } from "./session-registry"
import type { LiveSessionPreview, SessionSummary } from "./session-summary"
import {
  SessionHostError,
  type SessionAdapterFactory,
  type SessionEnvironmentFactory,
  type SessionHostEvent,
  type SessionMembership,
  type SessionModelCatalog,
  type SessionPermissionMode,
  type SessionRuntime,
  type SessionSendInput,
  type SessionStartInput,
  type SessionStatusView,
  type SessionTools,
  type SessionUsagePort,
} from "./session-types"

/** SessionHost 依赖；所有外部端口都可注入，便于不启动真实 CLI 的测试。 */
export type SessionHostOptions = {
  membership: SessionMembership
  runtime: SessionRuntime
  usage: SessionUsagePort
  userDataPath: string
  createEnvironment?: SessionEnvironmentFactory
  createAdapter?: SessionAdapterFactory
  resolveBinaryPath?: () => string
  resolveProfile?: SessionLaunchDeps["resolveProfile"]
  /** 桌面启动时打开的会话存储；省略时用于不落盘的宿主测试。 */
  sessionStore?: Promise<SessionStore | null>
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
} & Pick<SessionLaunchDeps, "projectPermissions">

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
  /** 会话历史和自动保留期，共用此宿主的进程释放顺序。 */
  readonly history: SavedSessionLibrary
  readonly #membership: SessionMembership
  readonly #now: () => number
  readonly #newId: () => string
  readonly #launchDeps: SessionLaunchDeps
  readonly #registry = new SessionRegistry()
  readonly #concurrency: SessionConcurrency
  readonly #persistence: SessionPersistence | null
  readonly #models: () => Promise<SessionModelCatalog>
  readonly #listeners = new Set<(envelope: SessionEnvelope) => void>()
  readonly #unsubscribe: (() => void)[]
  readonly #checkBeforeQueue = orderedSessionChecks()
  #disposed = false

  /** 创建会话宿主并订阅会员、换号和用量写入失败事件。 */
  constructor(options: SessionHostOptions) {
    this.#membership = options.membership
    this.#now = options.now ?? Date.now
    this.#newId = options.newId ?? (() => randomUUID())
    this.#persistence =
      options.sessionStore === undefined
        ? null
        : new SessionPersistence(options.sessionStore, () =>
            this.#emitHost({ type: "notice", message: "会话记录写入失败" }),
          )
    const timers = options.timers ?? realTimers
    this.#launchDeps = createSessionLaunchDeps(options, timers, this.#now, this.#newId)
    this.history = new SavedSessionLibrary({
      persistence: this.#persistence,
      userDataPath: options.userDataPath,
      timers,
      now: this.#now,
      authorize: () => this.#assertMembership(),
      stop: (id) => this.#registry.drainLaunches(id, () => this.stop(id)),
      active: (id) => (this.#registry.get(id)?.phase ?? "parked") !== "parked",
      removed: (id) => this.#registry.remove(id),
      notify: (event) => this.#emitHost(event),
    })
    this.#models = sessionModelReader(this.#launchDeps, options, (message) =>
      this.#emitHost({ type: "notice", message }),
    )
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
        if (entry !== null) void this.#park(entry, "idle").catch(() => this.#notifyExitPending())
      },
    })
    this.#unsubscribe = [
      options.usage.onWriteFailed(() => {
        this.#emitHost({ type: "error", code: "usage_write_failed", message: usageWriteFailed })
      }),
      options.membership.subscribe((view) => {
        if (view.state !== "active" && view.state !== "network_grace")
          void this.#handleMembershipLost().catch(() => this.#notifyExitPending())
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

  /** 按名额启动并保存新会话；同一活动会话复用启动结果，已停放的会话通过发送续接。 */
  async start(input: SessionStartInput, tools?: SessionTools): Promise<{ sessionId: string }> {
    if (this.#disposed) throw new SessionHostError("SDK_ERROR", "会话宿主已关闭")
    const store = this.#persistence === null ? undefined : await this.#persistence.ready
    if (store === null) {
      tools?.close()
      throw new SessionHostError("SESSION_START_FAILED", "会话存储不可用")
    }
    const existing = input.sessionId === undefined ? null : this.#registry.get(input.sessionId)
    if (existing !== null) {
      tools?.close()
      if (existing.phase === "parked") throw resumeFailed()
      return existing.launch ?? { sessionId: existing.sessionId }
    }
    const sessionId = input.sessionId ?? this.#newId()
    this.history.assertWritable(sessionId, tools?.close)
    checkFreshSessionId(store, sessionId, tools)
    const entry = this.#registry.add(sessionId, input.workspace, this.#now())
    entry.closeTools = tools?.close ?? null
    const launch = this.#launch(
      entry,
      input,
      tools?.servers,
      store ? { store, index: null } : undefined,
    )
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
    storage?: SessionLaunchStorage,
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
        checkBeforeQueue: this.#checkBeforeQueue,
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
        parkAfterRevocation: () => this.#park(entry, "stop"),
        ...(this.#persistence === null
          ? {}
          : { saveSettings: (settings) => this.#persistence?.settings(entry.sessionId, settings) }),
      }
      await launchSession(this.#launchDeps, input, entry.sessionId, hooks, servers, storage)
    } catch (error) {
      await this.#persistence?.flush(entry.sessionId)
      if (error instanceof SessionClaudeExitError) {
        entry.phase = "running"
        throw new SessionHostError("SESSION_START_FAILED", error.message)
      }
      if (storage) await rollbackSavedLaunch(storage, entry.sessionId).catch(() => undefined)
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
    tools?: () => SessionTools | undefined,
  ): Promise<void> {
    this.#assertMembership()
    if (this.#persistence !== null) await this.#ensureResumed(sessionId, tools)
    this.history.assertWritable(sessionId)
    await this.#requireSession(sessionId).send(input, checkpoint)
  }

  async #ensureResumed(sessionId: string, tools?: () => SessionTools | undefined): Promise<void> {
    const store = await this.#persistence?.ready
    this.history.assertWritable(sessionId)
    const current = this.#registry.get(sessionId)
    if (current?.phase === "running") return
    if (current?.launch) {
      await current.launch
      return
    }
    const index = store?.get(sessionId)
    if (!store || !index) return
    this.#assertMembership()
    if (this.#disposed) throw resumeFailed()
    const entry = this.#registry.prepareResume(index, this.#now())
    const launch = resumeSavedSession(
      index,
      { ...this.#launchDeps, cancelled: () => entry.cancelled !== null || this.#disposed },
      () => this.models(),
      tools,
      (input, scoped) => {
        entry.closeTools = scoped?.close ?? null
        return this.#launch(entry, input, scoped?.servers, { store, index })
      },
      () => this.#emitHost({ type: "notice", message: "原模型当前不可用，已使用默认模型续接" }),
    )
    entry.launch = launch
    try {
      await launch
    } catch (error) {
      if (entry.phase === "checking" && this.#registry.get(sessionId) === entry) this.#forget(entry)
      throw error
    } finally {
      entry.launch = null
    }
  }

  /** 取消该会话的当前回合。 */
  async cancel(sessionId: string): Promise<void> {
    await this.#registry.live(sessionId)?.cancel()
  }

  /** 写回指定会话的一次权限回答；未知会话或未知 requestId 都忽略。 */
  async respondPermission(sessionId: string, answer: PermissionAnswer): Promise<void> {
    await this.#registry.live(sessionId)?.respondPermission(answer)
  }

  /** 写回指定会话的提问回答，会员过期时拒绝。 */
  answerQuestion(sessionId: string, answer: QuestionAnswer): void {
    this.#assertMembership()
    this.#registry.live(sessionId)?.answerQuestion(answer)
  }

  /** 切换指定会话后续工具调用的权限模式。 */
  async setMode(sessionId: string, mode: SessionPermissionMode): Promise<void> {
    await this.#requireSession(sessionId).setMode(mode)
  }

  /** 切换指定会话后续回复使用的模型。 */
  async setModel(sessionId: string, model: string): Promise<void> {
    await this.#requireSession(sessionId).setModel(model)
  }

  /** 从宿主内存按序号补拉会话事件。 */
  events(sessionId: string, afterSeq: number): SessionEnvelope[] {
    this.#assertMembership()
    const session = this.#registry.get(sessionId)?.session ?? null
    if (session === null) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
    return session.events(afterSeq)
  }

  /** 等待磁盘索引可查询，应用窗口仍可在此之前打开。 */
  async ready(): Promise<void> {
    await this.#persistence?.ready
  }

  /** 读已保存历史的下一页，活动会话的补拉同时兼容尚未落盘的事件。 */
  async historyEvents(sessionId: string, afterSeq: number): Promise<SessionEnvelope[]> {
    this.#assertMembership()
    return (
      this.#persistence?.history(
        sessionId,
        afterSeq,
        (since) => this.#registry.get(sessionId)?.session?.events(since) ?? null,
      ) ?? this.events(sessionId, afterSeq)
    )
  }

  /** 停放指定会话并等待清理；不带 id 时停放所有会话，历史保留。 */
  async stop(sessionId?: string): Promise<void> {
    const entries = sessionId === undefined ? this.#registry.all() : [this.#registry.get(sessionId)]
    await Promise.all(
      entries.map((entry) => (entry === null ? undefined : this.#halt(entry, "SESSION_CANCELLED"))),
    )
  }

  /** 查询会员可用的模型目录，失败时使用已有降级逻辑。 */
  async models(): Promise<SessionModelCatalog> {
    return this.#models()
  }

  /** 返回会话快照；不带 id 时返回最近的活动会话。 */
  status(sessionId?: string): SessionStatusView {
    const saved = sessionId === undefined ? null : this.#persistence?.store?.get(sessionId)
    const view = this.#registry.status(sessionId, saved)
    if (view === null) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
    return view
  }

  /** 列出会话摘要，最近有活动的会话在前。 */
  list(archived = false): SessionSummary[] {
    this.#assertMembership()
    return this.#registry.summaries(this.#persistence?.store?.list(), archived)
  }

  /** 给本机托盘读取脱敏的运行会话，会员网络宽限期间仍能展示。 */
  livePreviews(): LiveSessionPreview[] {
    return this.#registry.livePreviews((id) => this.#persistence?.store?.get(id))
  }

  /** 和这个工作区重叠的运行中会话里有没有进行中的回合；工作台据此拒绝切分支和恢复检查点。 */
  hasActiveTurn(workspace: string): boolean {
    return this.#registry.hasActiveTurn(workspace)
  }

  /** 汇总退出会中断的会话、回合和审批，包括后台会话。 */
  pendingWork(): SessionPendingWork {
    return this.#registry.pendingWork()
  }

  /** 停放全部会话并释放全部订阅；应用退出时调用。 */
  async dispose(): Promise<void> {
    if (!this.#disposed) for (const unsubscribe of this.#unsubscribe) unsubscribe()
    this.#disposed = true
    await this.stop()
    await this.history.dispose()
    this.#concurrency.dispose(new SessionHostError("SESSION_CANCELLED", "会话启动已取消"))
    this.#listeners.clear()
  }

  async #halt(
    entry: SessionEntry,
    code: "SESSION_CANCELLED" | "MEMBERSHIP_REQUIRED",
  ): Promise<void> {
    if (entry.phase === "checking" || entry.phase === "queued") {
      entry.cancelled = code
      this.#concurrency.cancel(entry.sessionId, sessionLaunchCancellation(code))
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

  #notifyExitPending(): void {
    this.#emitHost({ type: "notice", message: "Claude Code 尚未停止，可重试停放会话" })
  }

  // 会话释放：交还名额、关掉会话专用的工具；运行中的会话转为停放，启动中的由启动流程收尾。
  async #released(entry: SessionEntry): Promise<void> {
    const status = this.#registry.statusOnRelease(entry)
    if (status !== null && this.#persistence !== null)
      await this.#persistence.park(entry.sessionId, status)
    this.#closeTools(entry)
    if (status !== null) entry.phase = "parked"
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
    this.#persistence?.observe(entry.sessionId, envelope)
    this.#concurrency.touch(entry.sessionId)
    notifySessionListeners(this.#listeners, envelope)
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
    notifySessionListeners(this.#listeners, hostEnvelope(event, this.#now()))
  }
}
function resumeFailed(): SessionHostError {
  return new SessionHostError("SESSION_RESUME_FAILED", "会话已停放，暂时不能接着使用")
}
