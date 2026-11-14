// 负责一个 Claude 会话的运行：发送、取消、权限回答、模式和模型切换、结束，以及把适配器事件变成会话事件和用量记录。
// 只依赖这一个会话的适配器、事件出口、时钟和定时器，不引用会话宿主或模块级单例。

import type { DevProviderOverride } from "./dev-provider"
import type { PermissionAnswer } from "./permission-broker"
import { classifyDaemonError } from "./session-error-mapping"
import type { SessionEvent } from "./session-events"
import { createActiveSession, type ActiveSession, type SessionTimers } from "./session-host-active"
import {
  enterRequestedMode,
  followReportedMode,
  switchPermissionMode,
  type ModeEvent,
} from "./session-host-modes"
import { applyModelChange } from "./session-host-provider"
import {
  assertTurnIdle,
  buildStartOptions,
  buildStatusView,
  buildUsageRecord,
  errorMessage,
  hostError,
  pendingWorkOf,
  redactSessionToken,
  sanitizeSessionEvent,
  type SessionPendingWork,
} from "./session-host-support"
import type { ClaudeAgentStartOptions } from "./claude-query-options"
import type {
  SessionAdapterFactory,
  SessionEnvironmentPort,
  SessionHostEvent,
  SessionPermissionMode,
  SessionRuntimeEvent,
  SessionSendInput,
  SessionStartInput,
  SessionStatusView,
} from "./session-types"
import type { UsageRecord } from "./usage-recorder"

/** 构造一个会话所需的全部依赖；都只属于这一个会话。 */
export type ClaudeSessionOptions = {
  sessionId: string
  /** 已按开发期供应商固定过模型的启动输入。 */
  input: SessionStartInput
  environment: SessionEnvironmentPort
  createAdapter: SessionAdapterFactory
  /** 事件出口；收到的事件都已脱敏。 */
  emit: (event: SessionHostEvent) => void
  recordUsage: (record: UsageRecord) => void
  /** 当前 daemon 会话令牌，只用于从错误文本里去掉它。 */
  sessionToken: () => string
  provider: DevProviderOverride | null
  permissionTimeoutMs: number
  timers: SessionTimers
  now: () => number
  newId: () => string
  /** 会话释放后调用一次，宿主据此放下对它的引用。 */
  onReleased: (session: ClaudeSession) => void
}

/** 一个 Claude 会话。保证结束路径只走一次；释放后忽略迟到的适配器事件和权限超时。 */
export class ClaudeSession {
  readonly state: ActiveSession
  readonly #options: ClaudeSessionOptions
  readonly #emitModeEvent = (event: ModeEvent): void => {
    if (event.type === "mode") this.#options.emit(event)
    else this.#options.emit({ ...event, message: this.#redact(event.message) })
  }

  /** 组装会话状态、权限代理和适配器；不启动 Claude Code。 */
  constructor(options: ClaudeSessionOptions) {
    this.#options = options
    this.state = createActiveSession(options.sessionId, options.input, options.environment, {
      createAdapter: options.createAdapter,
      permissionTimeoutMs: options.permissionTimeoutMs,
      timers: options.timers,
      emitPermission: (request) => options.emit(request),
      onPermissionTimeout: () => this.#handlePermissionTimeout(),
      onAdapterEvent: (_active, event) => this.#handleAdapterEvent(event),
    })
  }

  /** 会话已释放或正在结束。 */
  get closing(): boolean {
    return this.state.released || this.state.stopping
  }

  /** 启动 Claude Code 并进入用户选的权限模式；模式进不去时只提示，启动失败照常抛出。 */
  async launch(mcpServers: ClaudeAgentStartOptions["mcpServers"]): Promise<void> {
    await this.state.adapter.start({
      ...buildStartOptions(this.state, this.#options.input),
      ...(mcpServers ? { mcpServers } : {}),
    })
    await enterRequestedMode(this.state, this.#options.input.permissionMode, this.#emitModeEvent)
  }

  /** 广播会话当前生效的权限模式。 */
  announceMode(): void {
    this.#options.emit({ type: "mode", permissionMode: this.state.permissionMode })
  }

  /** 写入一条消息；如有工作台回调，在交给适配器之前记录基线。 */
  async send(input: SessionSendInput, checkpoint?: ActiveSession["checkpoint"]): Promise<void> {
    const active = this.state
    assertTurnIdle(active)
    active.turnId = this.#options.newId()
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
      throw hostError(code, message, this.#options.sessionToken())
    }
  }

  /** 取消当前 turn：立即拒绝未回答权限并中断，但保留会话供下一次发送。 */
  async cancel(): Promise<void> {
    const active = this.state
    if (active.turnId !== null) {
      active.turnCancelled = true
      active.turnErrorCode = "SESSION_CANCELLED"
      this.#options.emit({ type: "error", code: "SESSION_CANCELLED", message: "当前请求已取消" })
    }
    active.broker.rejectAll("用户已取消")
    await active.adapter.interrupt().catch(() => undefined)
  }

  /** 写回一次权限回答；未知 requestId 由 PermissionBroker 忽略。 */
  respondPermission(answer: PermissionAnswer): void {
    this.state.broker.respond(answer)
  }

  /** 切换后续工具调用的权限模式；自动审批被拒时不抛错，改发提示。 */
  async setMode(mode: SessionPermissionMode): Promise<void> {
    try {
      await switchPermissionMode(this.state, mode, this.#emitModeEvent)
    } catch (error) {
      throw hostError("SDK_ERROR", errorMessage(error), this.#options.sessionToken())
    }
  }

  /** 切换后续回复使用的模型；开发期供应商固定模型时不接受其他取值。 */
  async setModel(model: string): Promise<void> {
    await applyModelChange(this.state, this.#options.provider, model, this.#options.sessionToken())
  }

  /**
   * 结束会话：拒绝权限，再中断（会员失效时直接中止并报错）、停止适配器、清理环境。
   * 重复调用返回同一个 Promise。
   */
  end(rejectMessage: string, errorCode: "MEMBERSHIP_REQUIRED" | null): Promise<void> {
    const active = this.state
    if (active.ending !== null) return active.ending
    active.stopping = true
    active.ending = (async () => {
      active.broker.rejectAll(rejectMessage)
      if (errorCode !== null) {
        this.#options.emit({ type: "error", code: errorCode, message: rejectMessage })
        active.abort.abort()
      } else {
        await active.adapter.interrupt().catch(() => undefined)
      }
      await active.adapter.stop().catch(() => undefined)
      await this.release()
    })()
    return active.ending
  }

  /** 释放权限代理和会话环境；可重复调用，只在第一次通知宿主。 */
  async release(): Promise<void> {
    const active = this.state
    if (active.released) return
    active.released = true
    active.broker.dispose()
    this.#options.onReleased(this)
    await active.environment.cleanup().catch(() => undefined)
  }

  /** 记录换号：只有 turn 进行中的换号才记入用量，并广播换号事件。 */
  applyAccountSwitch(event: SessionRuntimeEvent): void {
    const active = this.state
    if (event.reason !== "initial" && event.from !== null && active.turnId !== null) {
      active.switchedFrom = event.from
    }
    active.accountId = event.to
    this.#options.emit({
      type: "account-switched",
      from: event.from,
      to: event.to,
      reason: event.reason,
    })
  }

  /** 返回脱敏会话快照。 */
  status(): SessionStatusView {
    return buildStatusView(this.state)
  }

  /** 退出会中断的工作；会话正在结束时为 0。 */
  pendingWork(): SessionPendingWork {
    return pendingWorkOf(this.state)
  }

  #handleAdapterEvent(event: SessionEvent): void {
    const active = this.state
    if (active.released) return
    switch (event.type) {
      case "started":
        active.model = event.model
        followReportedMode(active, event.permissionMode, "init", this.#emitModeEvent)
        break
      case "mode":
        followReportedMode(active, event.permissionMode, "status", this.#emitModeEvent)
        return
      case "result":
        if (active.turnId !== null) void active.checkpoint?.(active.environment.workspace, "final")
        this.#recordUsage(event)
        break
      case "error":
        active.turnErrorCode = event.code
        break
      case "ended":
        active.broker.rejectAll("会话已结束")
        this.#options.emit(sanitizeSessionEvent(event, this.#options.sessionToken()))
        if (!active.stopping) void this.release()
        return
      default:
        break
    }
    this.#options.emit(sanitizeSessionEvent(event, this.#options.sessionToken()))
  }

  #recordUsage(event: Extract<SessionEvent, { type: "result" }>): void {
    const active = this.state
    const record = buildUsageRecord(active, event, this.#options.now())
    if (record === null) return
    active.turnId = null
    active.turnCancelled = false
    active.turnErrorCode = null
    active.switchedFrom = null
    this.#options.recordUsage(record)
  }

  #handlePermissionTimeout(): void {
    const active = this.state
    if (active.released) return
    active.turnErrorCode = "PERMISSION_TIMEOUT"
    this.#options.emit({ type: "error", code: "PERMISSION_TIMEOUT", message: "权限询问超时" })
    // 同一 turn 的其它权限卡片不能继续悬挂。
    active.broker.rejectAll("权限询问超时")
    void active.adapter.interrupt().catch(() => undefined)
  }

  #redact(message: string): string {
    return redactSessionToken(message, this.#options.sessionToken())
  }
}
