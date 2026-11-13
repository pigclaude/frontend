// 负责管理一个窗口的唯一活动 Claude 会话：启动、发送、取消、权限回答、模式/模型切换、停止和事件广播。
import { randomUUID } from "node:crypto"
import { ClaudeAgentAdapter, type ClaudeAgentStartOptions } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { PermissionBroker } from "./permission-broker"
import type { PermissionAnswer } from "./permission-broker"
import { classifyDaemonError } from "./session-error-mapping"
import { SessionEnvironment, type ModelAuth } from "./session-environment"
import type { DevProviderOverride } from "./dev-provider"
import {
  applyModelChange,
  pinnedCatalog,
  pinnedStartInput,
  providerEnvironmentInput,
  providerSessionProfile,
} from "./session-host-provider"
import {
  assertStartNotStopped,
  assertTurnIdle,
  assertWorkspace,
  buildStartOptions,
  buildUsageRecord,
  createEnvironmentOrThrow,
  errorMessage,
  hostError,
  mapStartError,
  readBinaryPath,
  sanitizeSessionEvent,
  sanitizeStartError,
  assertMembershipActive,
  buildStatusView,
} from "./session-host-support"
import type { ActiveSession } from "./session-host-support"
import { normalizeSessionLocale, normalizeSessionTimezone } from "./session-locale"
import { queryModels } from "./session-models"
import { boundSessionEnvironment } from "./bound-session-environment"
import type {
  ClaudeModel,
  SessionAdapterFactory,
  SessionEnvironmentFactory,
  SessionEnvironmentPort,
  SessionHostEvent,
  SessionMembership,
  SessionPermissionMode,
  SessionProfile,
  SessionRuntime,
  SessionRuntimeEvent,
  SessionSendInput,
  SessionStartInput,
  SessionStatusView,
  SessionUsagePort,
} from "./session-types"
import { SessionHostError } from "./session-types"
import type { SessionEvent } from "./session-events"

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
  /** 模型目录查询用的账号凭据；缺省时退回占位 token。 */
  resolveModelAuth?: (accountId: string | null) => Promise<ModelAuth | null>
  /** 开发期自定义供应商；只由主进程在未打包时传入，不影响会员和账号门禁。 */
  provider?: DevProviderOverride | null
  defaultWorkspace?: () => string
  permissionTimeoutMs?: number
  now?: () => number
  newId?: () => string
}

const usageWriteFailedMessage = "用量记录写入失败"

/** 单活动会话宿主。保证同一时刻只有一个会话；启动失败不留半启动环境；停止后可再次启动。 */
export class SessionHost {
  readonly #membership: SessionMembership
  readonly #runtime: SessionRuntime
  readonly #usage: SessionUsagePort
  readonly #userDataPath: string
  readonly #createEnvironment: SessionEnvironmentFactory
  readonly #createAdapter: SessionAdapterFactory
  readonly #resolveBinaryPath: () => string
  readonly #resolveProfile: (accountId: string | null) => Promise<SessionProfile | null>
  readonly #resolveModelAuth: (accountId: string | null) => Promise<ModelAuth | null>
  readonly #provider: DevProviderOverride | null
  readonly #defaultWorkspace: () => string
  readonly #permissionTimeoutMs: number
  readonly #now: () => number
  readonly #newId: () => string
  readonly #listeners = new Set<(event: SessionHostEvent) => void>()
  readonly #unsubscribeMembership: () => void
  readonly #unsubscribeRuntime: () => void
  readonly #unsubscribeUsage: () => void
  #session: ActiveSession | null = null
  #startPromise: Promise<{ sessionId: string }> | null = null
  #stopRequested = false
  #closing: Promise<void> | null = null
  #disposed = false

  /** 创建会话宿主并订阅会员、换号和用量写入失败事件。 */
  constructor(options: SessionHostOptions) {
    this.#membership = options.membership
    this.#runtime = options.runtime
    this.#usage = options.usage
    this.#userDataPath = options.userDataPath
    this.#createEnvironment =
      options.createEnvironment ?? ((input) => SessionEnvironment.create(input))
    this.#createAdapter =
      options.createAdapter ?? ((onEvent) => new ClaudeAgentAdapter({ onEvent }))
    this.#resolveBinaryPath = options.resolveBinaryPath ?? (() => resolveClaudeBinaryPath())
    this.#resolveProfile = options.resolveProfile ?? (async () => null)
    this.#resolveModelAuth = options.resolveModelAuth ?? (async () => null)
    this.#provider = options.provider ?? null
    this.#defaultWorkspace = options.defaultWorkspace ?? (() => process.cwd())
    this.#permissionTimeoutMs = options.permissionTimeoutMs ?? 10 * 60 * 1_000
    this.#now = options.now ?? Date.now
    this.#newId = options.newId ?? (() => randomUUID())
    this.#unsubscribeUsage = this.#usage.onWriteFailed(() => {
      this.#emit({ type: "error", code: "usage_write_failed", message: usageWriteFailedMessage })
    })
    this.#unsubscribeMembership = this.#membership.subscribe((view) => {
      if (view.state === "active") return
      void this.#handleMembershipLost()
    })
    this.#unsubscribeRuntime = this.#runtime.subscribe((event) => this.#handleRuntimeEvent(event))
  }

  /** 订阅脱敏会话事件，返回取消订阅函数。 */
  subscribe(listener: (event: SessionHostEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 启动唯一活动会话；会员、工作区、可用账号或 daemon 不满足时不创建任何环境。 */
  async start(
    input: SessionStartInput,
    tools?: ClaudeAgentStartOptions["mcpServers"],
  ): Promise<{ sessionId: string }> {
    if (this.#disposed) throw new SessionHostError("SDK_ERROR", "会话宿主已关闭")
    if (this.#session !== null || this.#closing !== null || this.#startPromise !== null) {
      throw new SessionHostError("SESSION_ALREADY_ACTIVE", "已有活动会话")
    }
    this.#stopRequested = false
    const promise = this.#startSession(input, tools).catch((error: unknown) => {
      throw sanitizeStartError(error, this.#runtime.sessionToken)
    })
    this.#startPromise = promise
    try {
      return await promise
    } finally {
      if (this.#startPromise === promise) this.#startPromise = null
    }
  }
  async #startSession(
    input: SessionStartInput,
    mcpServers: ClaudeAgentStartOptions["mcpServers"],
  ): Promise<{ sessionId: string }> {
    await assertMembershipActive(this.#membership)
    assertStartNotStopped(this.#stopRequested, this.#disposed)
    await assertWorkspace(input.workspace)
    assertStartNotStopped(this.#stopRequested, this.#disposed)
    // 开发期供应商自带模型访问，不再要求本机有可用的 Claude 账号。
    if (this.#provider === null && !(await this.#runtime.hasAvailableAccount())) {
      throw new SessionHostError("NO_AVAILABLE_ACCOUNT", "没有可用的 Claude 账号")
    }
    assertStartNotStopped(this.#stopRequested, this.#disposed)
    const daemonBaseUrl = this.#runtime.daemonBaseUrl
    if (daemonBaseUrl === null) {
      throw new SessionHostError("DAEMON_UNAVAILABLE", "本机 daemon 尚未就绪")
    }
    const binaryPath = readBinaryPath(this.#resolveBinaryPath, this.#runtime.sessionToken)
    this.#runtime.beginSession?.()
    this.#runtime.setPreferredAccount?.(input.accountId ?? null)
    const sessionId = this.#newId()
    const resolvedProfile = await this.#resolveProfile(input.accountId ?? null)
    const profile =
      this.#provider === null ? resolvedProfile : providerSessionProfile(resolvedProfile)
    assertStartNotStopped(this.#stopRequested, this.#disposed)
    const environment = await createEnvironmentOrThrow(
      (environmentInput) =>
        boundSessionEnvironment(this.#runtime, profile, this.#createEnvironment, environmentInput),
      {
        sessionId,
        workspace: input.workspace,
        daemonBaseUrl,
        sessionToken: this.#runtime.sessionToken,
        timezone: normalizeSessionTimezone(profile?.timezone),
        locale: normalizeSessionLocale(profile?.locale),
        binaryPath,
        userDataPath: this.#userDataPath,
        ...providerEnvironmentInput(this.#provider),
      },
      this.#runtime.sessionToken,
    )
    if (this.#stopRequested || this.#disposed) {
      await environment.cleanup().catch(() => undefined)
      throw new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
    }
    if (this.#membership.view().state !== "active") {
      await environment.cleanup().catch(() => undefined)
      throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
    }
    const effectiveInput = pinnedStartInput(this.#provider, input)
    const active = this.#createActiveSession(sessionId, effectiveInput, environment)
    this.#session = active
    try {
      await active.adapter.start({
        ...buildStartOptions(active, effectiveInput),
        ...(mcpServers ? { mcpServers } : {}),
      })
    } catch (error) {
      await this.#release(active)
      if (this.#stopRequested || this.#disposed) {
        throw new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
      }
      throw mapStartError(error, this.#runtime.sessionToken)
    }
    if (this.#stopRequested || this.#disposed) {
      await this.#release(active)
      throw new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
    }
    if (active.released || active.stopping) {
      if (this.#membership.view().state !== "active") {
        throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
      }
      throw new SessionHostError("SDK_ERROR", "会话在启动期间结束")
    }
    return { sessionId }
  }

  /** 写入当前消息；如有工作台回调，在交给适配器之前记录基线。 */
  async send(input: SessionSendInput, checkpoint?: ActiveSession["checkpoint"]): Promise<void> {
    const active = this.#requireActive()
    assertTurnIdle(active)
    active.turnId = this.#newId()
    active.turnCancelled = false
    active.turnErrorCode = null
    active.checkpoint = checkpoint
    try {
      await checkpoint?.(active.environment.workspace, "baseline")
      if (active.stopping || active.released || active.turnCancelled) {
        active.turnId = null
        return
      }
      await active.adapter.send(input.text)
    } catch (error) {
      active.turnId = null
      const message = errorMessage(error)
      const code = classifyDaemonError(message) ?? "SDK_ERROR"
      throw hostError(code, message, this.#runtime.sessionToken)
    }
  }

  /** 取消当前 turn：立即拒绝未回答权限并中断，但保留会话供下一次发送。 */
  async cancel(): Promise<void> {
    const active = this.#session
    if (active === null) return
    if (active.turnId !== null) {
      active.turnCancelled = true
      active.turnErrorCode = "SESSION_CANCELLED"
      this.#emit({ type: "error", code: "SESSION_CANCELLED", message: "当前请求已取消" })
    }
    active.broker.rejectAll("用户已取消")
    await active.adapter.interrupt().catch(() => undefined)
  }

  /** 写回一次权限回答；未知 requestId 由 PermissionBroker 忽略。 */
  async respondPermission(answer: PermissionAnswer): Promise<void> {
    const active = this.#session
    if (active === null) return
    active.broker.respond(answer)
  }

  /** 切换后续工具调用的权限模式；等待中的权限请求保持原模式。 */
  async setMode(mode: SessionPermissionMode): Promise<void> {
    const active = this.#requireActive()
    try {
      await active.adapter.setPermissionMode(mode)
      active.permissionMode = mode
    } catch (error) {
      throw hostError("SDK_ERROR", errorMessage(error), this.#runtime.sessionToken)
    }
  }

  /** 切换后续回复使用的模型；不影响已发出的请求。开发期供应商固定模型时不接受其他取值。 */
  async setModel(model: string): Promise<void> {
    const active = this.#requireActive()
    await applyModelChange(active, this.#provider, model, this.#runtime.sessionToken)
  }

  /** 停止会话：先拒绝未回答权限，再中断、停止适配器并删除会话目录；可重复调用。 */
  async stop(): Promise<void> {
    this.#stopRequested = true
    const pendingStart = this.#startPromise
    if (this.#closing !== null) return this.#closing
    const active = this.#session
    if (active === null) {
      // 启动尚未分配会话时，等它观察到停止请求并自行清理。
      if (pendingStart !== null) await pendingStart.catch(() => undefined)
      return
    }
    const task = this.#endSession(active, "会话已停止", null)
    this.#closing = task
    try {
      await task
    } finally {
      if (this.#closing === task) this.#closing = null
    }
  }

  /** 查询支持模型；开发期供应商固定模型时直接返回单项目录，否则用真实账号凭据读完整目录。 */
  async models(): Promise<ClaudeModel[]> {
    await assertMembershipActive(this.#membership)
    const pinned = pinnedCatalog(this.#provider)
    if (pinned !== null) return pinned
    return queryModels({
      assertMembership: () => assertMembershipActive(this.#membership),
      runtime: this.#runtime,
      createEnvironment: this.#createEnvironment,
      createAdapter: this.#createAdapter,
      resolveProfile: this.#resolveProfile,
      resolveModelAuth: this.#resolveModelAuth,
      defaultWorkspace: this.#defaultWorkspace,
      readBinaryPath: () => readBinaryPath(this.#resolveBinaryPath, this.#runtime.sessionToken),
      userDataPath: this.#userDataPath,
      newId: this.#newId,
      hostError: (code, message) => hostError(code, message, this.#runtime.sessionToken),
    })
  }

  /** 返回脱敏会话快照；没有活动会话时所有 id 和模型为 null。 */
  status(): SessionStatusView {
    return buildStatusView(this.#session)
  }

  /** 停止会话并释放全部订阅；应用退出时调用。 */
  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribeMembership()
    this.#unsubscribeRuntime()
    this.#unsubscribeUsage()
    await this.stop()
    this.#listeners.clear()
  }

  #createActiveSession(
    sessionId: string,
    input: SessionStartInput,
    environment: SessionEnvironmentPort,
  ): ActiveSession {
    const holder: { current: ActiveSession | null } = { current: null }
    const broker = new PermissionBroker({
      emit: (request) => this.#emit({ ...request }),
      onTimeout: () => {
        const active = holder.current
        if (active !== null) this.#handlePermissionTimeout(active)
      },
      timeoutMs: this.#permissionTimeoutMs,
    })
    const adapter = this.#createAdapter((event) => {
      const active = holder.current
      if (active !== null) this.#handleAdapterEvent(active, event)
    })
    const active: ActiveSession = {
      sessionId,
      environment,
      adapter,
      broker,
      abort: new AbortController(),
      model: input.model ?? null,
      permissionMode: input.permissionMode,
      accountId: input.accountId ?? null,
      switchedFrom: null,
      turnId: null,
      turnCancelled: false,
      turnErrorCode: null,
      stopping: false,
      ending: null,
      released: false,
    }
    holder.current = active
    return active
  }

  // 结束会话共用路径：拒绝权限 -> 中止/中断 -> 停止适配器 -> 清理环境。
  async #endSession(
    active: ActiveSession,
    rejectMessage: string,
    errorCode: "MEMBERSHIP_REQUIRED" | null,
  ): Promise<void> {
    if (active.ending !== null) return active.ending
    active.stopping = true
    active.ending = (async () => {
      active.broker.rejectAll(rejectMessage)
      if (errorCode !== null) {
        this.#emit({ type: "error", code: errorCode, message: rejectMessage })
        active.abort.abort()
      } else {
        await active.adapter.interrupt().catch(() => undefined)
      }
      await active.adapter.stop().catch(() => undefined)
      await this.#release(active)
    })()
    return active.ending
  }

  async #release(active: ActiveSession): Promise<void> {
    if (active.released) return
    active.released = true
    active.broker.dispose()
    if (this.#session === active) this.#session = null
    await active.environment.cleanup().catch(() => undefined)
  }

  async #handleMembershipLost(): Promise<void> {
    const active = this.#session
    if (active === null) return
    await this.#endSession(active, "会员状态已失效", "MEMBERSHIP_REQUIRED")
  }

  #handleRuntimeEvent(event: SessionRuntimeEvent): void {
    const active = this.#session
    if (active === null) return
    // 只有 turn 进行中的换号才记入用量；两次 turn 之间的换号不制造 switchedFrom。
    if (event.reason !== "initial" && event.from !== null && active.turnId !== null) {
      active.switchedFrom = event.from
    }
    active.accountId = event.to
    this.#emit({
      type: "account-switched",
      from: event.from,
      to: event.to,
      reason: event.reason,
    })
  }

  #handleAdapterEvent(active: ActiveSession, event: SessionEvent): void {
    if (active.released) return
    switch (event.type) {
      case "started":
        active.model = event.model
        break
      case "result":
        if (active.turnId !== null) void active.checkpoint?.(active.environment.workspace, "final")
        this.#recordUsage(active, event)
        break
      case "error":
        active.turnErrorCode = event.code
        break
      case "ended":
        active.broker.rejectAll("会话已结束")
        this.#emit(sanitizeSessionEvent(event, this.#runtime.sessionToken))
        if (!active.stopping) void this.#release(active)
        return
      default:
        break
    }
    this.#emit(sanitizeSessionEvent(event, this.#runtime.sessionToken))
  }

  #recordUsage(active: ActiveSession, event: Extract<SessionEvent, { type: "result" }>): void {
    const record = buildUsageRecord(active, event, this.#now())
    if (record === null) return
    active.turnId = null
    active.turnCancelled = false
    active.turnErrorCode = null
    active.switchedFrom = null
    void this.#usage.record(record)
  }

  #handlePermissionTimeout(active: ActiveSession): void {
    if (this.#session !== active || active.released) return
    active.turnErrorCode = "PERMISSION_TIMEOUT"
    this.#emit({ type: "error", code: "PERMISSION_TIMEOUT", message: "权限询问超时" })
    // 同一 turn 的其它权限卡片不能继续悬挂。
    active.broker.rejectAll("权限询问超时")
    void active.adapter.interrupt().catch(() => undefined)
  }

  #requireActive(): ActiveSession {
    const active = this.#session
    if (active === null) throw new SessionHostError("SDK_ERROR", "会话未开始")
    return active
  }

  #emit(event: SessionHostEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event)
      } catch {
        // 单个订阅者失败不能中断会话。
      }
    }
  }
}
