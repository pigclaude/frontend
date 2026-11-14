// 负责编排一个窗口的唯一活动 Claude 会话：启动前检查、把命令交给 ClaudeSession、停止、模型目录和事件广播。
import { randomUUID } from "node:crypto"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { readOrganizationModels, type OrganizationModelReader } from "./claude-bootstrap"
import type { ClaudeAgentStartOptions } from "./claude-query-options"
import { ClaudeSession } from "./claude-session"
import type { DevProviderOverride } from "./dev-provider"
import type { PermissionAnswer } from "./permission-broker"
import { SessionEnvironment } from "./session-environment"
import type { ActiveSession } from "./session-host-active"
import { pinnedCatalog } from "./session-host-provider"
import {
  assertMembershipActive,
  buildStatusView,
  hostError,
  mapStartError,
  readBinaryPath,
  sanitizeStartError,
  pendingWorkOf,
  type SessionPendingWork,
} from "./session-host-support"
import { queryModels } from "./session-models"
import { prepareSessionStart } from "./session-start-checks"
import type {
  SessionAdapterFactory,
  SessionEnvironmentFactory,
  SessionHostEvent,
  SessionMembership,
  SessionModelCatalog,
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
  readonly #readOrganizationModels: OrganizationModelReader
  readonly #provider: DevProviderOverride | null
  readonly #defaultWorkspace: () => string
  readonly #permissionTimeoutMs: number
  readonly #now: () => number
  readonly #newId: () => string
  readonly #listeners = new Set<(event: SessionHostEvent) => void>()
  readonly #unsubscribeMembership: () => void
  readonly #unsubscribeRuntime: () => void
  readonly #unsubscribeUsage: () => void
  #session: ClaudeSession | null = null
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
    this.#readOrganizationModels = options.readOrganizationModels ?? readOrganizationModels
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
    const prepared = await prepareSessionStart(
      {
        membership: this.#membership,
        runtime: this.#runtime,
        provider: this.#provider,
        createEnvironment: this.#createEnvironment,
        resolveBinaryPath: this.#resolveBinaryPath,
        resolveProfile: this.#resolveProfile,
        userDataPath: this.#userDataPath,
        newId: this.#newId,
        cancelled: () => this.#stopRequested || this.#disposed,
      },
      input,
    )
    const session = new ClaudeSession({
      ...prepared,
      createAdapter: this.#createAdapter,
      emit: (event) => this.#emit(event),
      recordUsage: (record) => void this.#usage.record(record),
      sessionToken: () => this.#runtime.sessionToken,
      provider: this.#provider,
      permissionTimeoutMs: this.#permissionTimeoutMs,
      now: this.#now,
      newId: this.#newId,
      onReleased: (released) => {
        if (this.#session === released) this.#session = null
      },
    })
    this.#session = session
    try {
      await session.launch(mcpServers)
    } catch (error) {
      await session.release()
      if (this.#stopRequested || this.#disposed) {
        throw new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
      }
      throw mapStartError(error, this.#runtime.sessionToken)
    }
    if (this.#stopRequested || this.#disposed) {
      await session.release()
      throw new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
    }
    if (session.closing) {
      if (this.#membership.view().state !== "active") {
        throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
      }
      throw new SessionHostError("SDK_ERROR", "会话在启动期间结束")
    }
    session.announceMode()
    return { sessionId: prepared.sessionId }
  }

  /** 写入当前消息；如有工作台回调，在交给适配器之前记录基线。 */
  async send(input: SessionSendInput, checkpoint?: ActiveSession["checkpoint"]): Promise<void> {
    await this.#requireActive().send(input, checkpoint)
  }

  /** 取消当前 turn：立即拒绝未回答权限并中断，但保留会话供下一次发送。 */
  async cancel(): Promise<void> {
    await this.#session?.cancel()
  }

  /** 写回一次权限回答；未知 requestId 由 PermissionBroker 忽略。 */
  async respondPermission(answer: PermissionAnswer): Promise<void> {
    this.#session?.respondPermission(answer)
  }

  /** 切换后续工具调用的权限模式；等待中的权限请求保持原模式。自动审批被拒时不抛错，改发提示。 */
  async setMode(mode: SessionPermissionMode): Promise<void> {
    await this.#requireActive().setMode(mode)
  }

  /** 切换后续回复使用的模型；不影响已发出的请求。开发期供应商固定模型时不接受其他取值。 */
  async setModel(model: string): Promise<void> {
    await this.#requireActive().setModel(model)
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
    const task = active.end("会话已停止", null)
    this.#closing = task
    try {
      await task
    } finally {
      if (this.#closing === task) this.#closing = null
    }
  }

  /** 查询模型目录；开发期供应商固定模型时直接返回单项目录。会员有效时列表不为空，降级时发一次提示。 */
  async models(): Promise<SessionModelCatalog> {
    await assertMembershipActive(this.#membership)
    const pinned = pinnedCatalog(this.#provider)
    if (pinned !== null) return { models: pinned, cliError: null }
    return queryModels({
      assertMembership: () => assertMembershipActive(this.#membership),
      runtime: this.#runtime,
      createEnvironment: this.#createEnvironment,
      createAdapter: this.#createAdapter,
      resolveProfile: this.#resolveProfile,
      readOrganizationModels: this.#readOrganizationModels,
      defaultWorkspace: this.#defaultWorkspace,
      readBinaryPath: () => readBinaryPath(this.#resolveBinaryPath, this.#runtime.sessionToken),
      userDataPath: this.#userDataPath,
      newId: this.#newId,
      now: this.#now,
      hostError: (code, message) => hostError(code, message, this.#runtime.sessionToken),
      notify: (message) => this.#emit({ type: "notice", message }),
    })
  }

  /** 返回脱敏会话快照；没有活动会话时所有 id 和模型为 null。 */
  status(): SessionStatusView {
    return this.#session?.status() ?? buildStatusView(null)
  }

  /** 退出前要确认的工作：进行中的回合和等待回答的权限；正在结束的会话不算。 */
  pendingWork(): SessionPendingWork {
    return pendingWorkOf(this.#session?.state ?? null)
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

  async #handleMembershipLost(): Promise<void> {
    const active = this.#session
    if (active === null) return
    await active.end("会员状态已失效", "MEMBERSHIP_REQUIRED")
  }

  #handleRuntimeEvent(event: SessionRuntimeEvent): void {
    this.#session?.applyAccountSwitch(event)
  }

  #requireActive(): ClaudeSession {
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
