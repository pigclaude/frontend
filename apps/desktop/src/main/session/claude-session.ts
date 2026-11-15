// 负责一个 Claude 会话的运行：发送、取消、权限和提问的回答、模式和模型切换、结束，以及把适配器事件变成会话事件和用量记录。
// 回合开闭交给 SessionTurns；发出的事件都经这个会话自己的事件日志盖上时间和序号。
// 只依赖这一个会话的适配器、事件出口、时钟和定时器，不引用会话宿主或模块级单例。

import { ContextUsageQuery } from "./context-usage-query"
import type { CapabilityPluginToolApprovals } from "../plugins/capability-plugin-tools"
import type { PendingAnswerKind } from "./pending-answers"
import { cancelledPermissionMessage, type PermissionAnswer } from "./permission-broker"
import type { QuestionAnswer } from "./question-broker"
import type { SessionEnvelope } from "./session-envelope"
import { classifyDaemonError } from "./session-error-mapping"
import { LiveReply } from "./live-reply"
import { SessionEventLog } from "./session-event-log"
import { SessionClaudeExitError } from "./session-claude-launch"
import { SessionTurnFlags, type FastModeNoticeKey } from "./session-flags"
import { createActiveSession, type ActiveSession } from "./session-host-active"
import {
  enterRequestedMode,
  followReportedMode,
  switchPermissionMode,
  type ModeEvent,
} from "./session-host-modes"
import { applyModelChange } from "./session-host-provider"
import {
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
import type { ClaudeSessionOptions, SessionSavedSettings } from "./claude-session-options"
import type { AdapterEvent } from "./session-events"
import type { FinishReferenceDelivery, PreparedSessionReferences } from "./session-reference-access"
import type { ClosedTurn } from "./session-turns"
import type {
  SessionHostEvent,
  SessionPermissionMode,
  SessionRuntimeEvent,
  SessionSendInput,
  SessionStatusView,
  SessionTurnEvent,
} from "./session-types"
import { TurnStallWatchdog, turnStallMs } from "./turn-stall-watchdog"
import type { WorkflowEvent } from "./workflow-tasks"

/** 一个 Claude 会话。保证结束路径只走一次；释放后忽略迟到的适配器事件和权限超时；发出的事件时间不倒退、序号连续。 */
export class ClaudeSession {
  readonly state: ActiveSession
  readonly #options: ClaudeSessionOptions
  readonly #log: SessionEventLog
  readonly #reply: LiveReply
  readonly #stall: TurnStallWatchdog
  readonly #flags: SessionTurnFlags
  #started = false
  readonly #context = new ContextUsageQuery({
    read: () => this.state.adapter.contextUsage(),
    emit: (event) => this.#publish(event),
  })
  #release: Promise<void> | null = null
  #reportCleanupFailure = false
  readonly #emitModeEvent = (event: ModeEvent): void => {
    if (event.type === "mode") this.#publish(event)
    else this.#publish({ ...event, message: this.#redact(event.message) })
  }

  /** 组装会话状态、事件日志、待答队列、权限和提问代理以及适配器；不启动 Claude Code。 */
  constructor(options: ClaudeSessionOptions) {
    this.#options = options
    this.#log = new SessionEventLog(options.sessionId, options.now, options.persistence?.cursor)
    this.#reply = new LiveReply(options.now)
    this.#stall = new TurnStallWatchdog(options.timers, options.now, () =>
      this.#publish({
        type: "notice",
        key: "run.stalled",
        level: "warning",
        params: { seconds: String(turnStallMs / 1_000) },
      }),
    )
    this.state = createActiveSession(options.sessionId, options.input, options.environment, {
      createAdapter: options.createAdapter,
      ...(options.projectPermissions === undefined
        ? {}
        : { saveProjectGrants: options.projectPermissions.save }),
      permissionTimeoutMs: options.permissionTimeoutMs,
      timers: options.timers,
      now: options.now,
      ...(options.persistence?.usageBaseline === undefined
        ? {}
        : { usageBaseline: options.persistence.usageBaseline }),
      emitPermission: (request) => this.#publish(request),
      onPermissionSettled: () => this.#publish({ type: "sessions-changed" }),
      emitQuestion: (event) => this.#publish(event),
      emitTurn: (event) => this.#publishTurn(event),
      onTurnClosed: (_active, turn) => this.#handleTurnClosed(turn),
      onAnswerTimeout: (_active, kind) => this.#handleAnswerTimeout(kind),
      onWaitingChange: (waiting) => this.#stall.setWaiting(waiting),
      onAdapterEvent: (_active, event) => this.#handleAdapterEvent(event),
    })
    this.#flags = new SessionTurnFlags(this.state.adapter, options.input)
  }

  /** 会话已释放或正在结束。 */
  get closing(): boolean {
    return this.state.released || this.state.stopping
  }

  /** 启动 Claude Code 并进入用户选的权限模式；模式进不去时只提示，启动失败照常抛出。 */
  async launch(
    mcpServers: ClaudeAgentStartOptions["mcpServers"],
    pluginApprovals?: CapabilityPluginToolApprovals,
  ): Promise<void> {
    const options: ClaudeAgentStartOptions = {
      ...buildStartOptions(
        this.state,
        this.#options.input,
        this.#options.references !== undefined,
        this.#options.denyUnattended,
        pluginApprovals,
      ),
      ...(mcpServers ? { mcpServers } : {}),
      ...(this.#options.persistence === undefined
        ? {}
        : { persistence: this.#options.persistence }),
    }
    const project = this.#options.projectPermissions
    if (project === undefined) await this.state.adapter.start(options)
    else {
      await project.start(this.state.adapter, options, {
        onFailure: () =>
          this.#publish({
            type: "notice",
            message: "当前会话未能应用最新项目授权，请重新打开会话",
          }),
        onRevokeFailure: () => this.#stopAfterRevocation(),
      })
    }
    await enterRequestedMode(this.state, this.#options.input.permissionMode, this.#emitModeEvent)
  }

  /** 广播会话当前生效的权限模式。 */
  announceMode(): void {
    this.#publish({ type: "mode", permissionMode: this.state.permissionMode })
  }

  /**
   * 更新本轮设置后写入消息，被接受后开一轮；如有工作台回调，在交给适配器之前记录基线。
   * 上一轮（含它的后台子代理和工作流）没结束时抛 TURN_ACTIVE。
   */
  async send(input: SessionSendInput, checkpoint?: ActiveSession["checkpoint"]): Promise<void> {
    const active = this.state
    const turnId = active.turns.reserve(this.#options.newId)
    const canSend = () => active.turns.holds(turnId) && !this.closing
    active.checkpoint = checkpoint
    const access = this.#options.references
    let prepared: PreparedSessionReferences | undefined
    let finishDelivery: FinishReferenceDelivery | undefined
    try {
      await checkpoint?.(active.environment.workspace, "baseline", turnId)
      await this.#flags.apply(input, canSend)
      if (canSend() && access !== undefined && input.references?.length)
        prepared = await access.prepare(input, (title) => this.#redact(title))
      if (!canSend()) {
        active.turns.release(turnId)
        return
      }
      this.#options.saveSettings?.(this.savedSettings())
      this.#flags.expectInit(turnId)
      finishDelivery = prepared && access?.beforeDelivery(prepared.instances)
      await active.adapter.send(prepared?.prompt ?? input.text)
    } catch (error) {
      if (finishDelivery !== undefined) await finishDelivery(false)
      this.#flags.ended(turnId)
      if (!active.turns.holds(turnId)) return
      active.turns.release(turnId)
      const message = errorMessage(error)
      const code = classifyDaemonError(message) ?? "SDK_ERROR"
      throw hostError(code, message, this.#options.sessionToken())
    }
    if (!canSend()) {
      if (finishDelivery !== undefined) await finishDelivery(false)
      active.turns.release(turnId)
      this.#flags.ended(turnId)
      return
    }
    const saved = finishDelivery?.(true).catch(() => {
      if (!this.closing) this.#publish({ type: "notice", message: "会话引用记录写入失败" })
    })
    active.turns.open(
      turnId,
      this.#options.persistence ? this.#redact(input.text) : undefined,
      prepared?.references,
    )
    this.#publishFastNotice(this.#flags.opened(turnId))
    if (saved !== undefined) await saved
  }

  /** 停止当前一轮：拒绝未回答的权限和提问，中断并停止在途后台任务，以中断结束这一轮；会话保留供下一次发送。 */
  async cancel(): Promise<void> {
    const active = this.state
    this.#stall.stop()
    const turnId = active.turns.turnId
    if (turnId !== null) this.#flags.ended(turnId)
    this.#options.references?.cancelPendingDeliveries()
    active.pending.rejectAll("用户已取消")
    await active.turns.interrupt("interrupted", "SESSION_CANCELLED")
  }

  /** 写回一次权限回答；未知 requestId 由 PermissionBroker 忽略。 */
  async respondPermission(answer: PermissionAnswer): Promise<void> {
    await this.state.broker.respond(answer)
  }

  /** 写回一次提问的回答；未知 requestId 忽略，答案条数和问题数不一致时抛 INVALID_SESSION_INPUT。 */
  answerQuestion(answer: QuestionAnswer): void {
    this.state.questions.answer(answer)
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
    this.#context.request()
    this.#options.saveSettings?.(this.savedSettings())
  }

  /** 可在下一次启动续接时使用的最新模型与控制设置。 */
  savedSettings(): SessionSavedSettings {
    return { model: this.state.model, ...this.#flags.settings }
  }

  /**
   * 结束会话：拒绝权限和提问，再中断并停止在途后台任务（会员失效时直接中止并报错），以中断结束进行中的一轮，
   * 然后保存历史、停止适配器并清理环境。重复调用返回同一个 Promise。
   */
  end(rejectMessage: string, errorCode: "MEMBERSHIP_REQUIRED" | null): Promise<void> {
    const active = this.state
    if (active.ending !== null) return active.ending
    if (this.#release !== null) return this.#release
    this.#stall.stop()
    active.stopping = true
    active.pluginCalls.abort()
    this.#options.references?.cancelPendingDeliveries()
    this.#context.stop()
    active.ending = (async () => {
      active.pending.rejectAll(rejectMessage)
      if (errorCode !== null) {
        this.#publish({ type: "error", code: errorCode, message: rejectMessage })
        active.abort.abort()
        active.turns.end("interrupted", errorCode)
      } else {
        await active.turns.shutdown()
      }
      await this.#options.flushHistory?.(errorCode === null && !this.#reportCleanupFailure)
      await active.adapter.stop().catch((error: unknown) => {
        if (this.#reportCleanupFailure || error instanceof SessionClaudeExitError) throw error
      })
      await this.release()
    })().catch((error: unknown) => {
      active.ending = null
      throw error
    })
    return active.ending
  }

  async #stopAfterRevocation(): Promise<void> {
    this.#reportCleanupFailure = true
    const message = "当前会话未能更新已撤销的项目授权，正在停放"
    this.#publish({ type: "notice", message })
    try {
      this.#options.revokeRouting?.()
    } finally {
      this.state.abort.abort()
      await (this.#options.parkAfterRevocation?.() ?? this.end(message, null))
    }
  }

  /** 拒绝还没回答的权限和提问，清理环境后通知宿主；并发调用等待同一次清理。 */
  release(): Promise<void> {
    if (this.#release !== null) return this.#release
    const active = this.state
    active.released = true
    active.pluginCalls.abort()
    this.#options.references?.cancelPendingDeliveries()
    this.#stall.stop()
    this.#context.stop()
    this.#release = Promise.resolve().then(() => this.#releaseEnvironment())
    return this.#release
  }

  async #releaseEnvironment(): Promise<void> {
    const active = this.state
    active.pending.rejectAll(cancelledPermissionMessage)
    const cleanup = await active.environment.cleanup().catch((error: unknown) => ({ error }))
    await this.#options.onReleased(this)
    if (this.#reportCleanupFailure && cleanup) throw cleanup.error
  }

  /**
   * 记录换号：只有 turn 进行中的换号才记入用量，并广播换号事件。
   * 第一次选号没有用上偏好的账号时，再发一条提示说明已经换用别的账号；之后的换号补查一次上下文占用。
   */
  applyAccountSwitch(event: SessionRuntimeEvent): void {
    const active = this.state
    if (event.reason !== "initial" && event.from !== null && active.turns.turnId !== null) {
      active.switchedFrom = event.from
    }
    active.accountId = event.to
    this.#publish({
      type: "account-switched",
      from: event.from,
      to: event.to,
      reason: event.reason,
    })
    if (event.reason !== "initial") this.#context.request()
    const preferred = active.preferredAccountId
    if (event.reason === "initial" && preferred !== null && event.to !== preferred) {
      this.#publish({
        type: "notice",
        message: "偏好的 Claude 账号现在不可用，已按切换规则改用其他账号。",
      })
    }
  }

  /** 返回脱敏会话快照。 */
  status(): SessionStatusView {
    return buildStatusView(this.state)
  }

  /** 按序号补拉这个会话要保存的事件：序号大于 afterSeq 的部分，按序号排列，一次有上限。 */
  events(afterSeq: number): SessionEnvelope[] {
    return this.#log.since(afterSeq)
  }

  /** 退出会中断的工作；会话正在结束时为 0。 */
  pendingWork(): SessionPendingWork {
    return pendingWorkOf(this.state)
  }

  #handleAdapterEvent(event: AdapterEvent): void {
    const active = this.state
    if (active.released) return
    this.#stall.activity()
    this.#context.observe(event)
    switch (event.type) {
      case "sdk-activity":
        return
      case "exit-pending":
        active.stopping = true
        this.#options.references?.cancelPendingDeliveries()
        this.#stall.stop()
        active.pending.rejectAll(cancelledPermissionMessage)
        this.#publish({ type: "error", code: "SDK_ERROR", message: "Claude Code 尚未确认退出" })
        active.turns.end("error", "SDK_ERROR")
        return
      case "background-tasks":
      case "background-task-started":
      case "background-task-ended":
        active.turns.observe(event)
        return
      case "task-started":
        active.subagents.started(event)
        this.#publishWorkflow(active.workflows.task(event))
        return
      case "task-progress":
        this.#publishWorkflow(active.workflows.task(event))
        return
      case "task-ended": {
        const ended = active.subagents.ended(event)
        if (ended !== null) this.#publish(ended)
        this.#publishWorkflow(active.workflows.task(event))
        return
      }
      case "context-compacted":
        return
      case "started": {
        active.model = event.model
        active.turns.observe(event)
        followReportedMode(active, event.permissionMode, "init", this.#emitModeEvent)
        if (!this.#started) {
          this.#started = true
          this.#publish({
            type: "started",
            sessionId: event.sessionId,
            model: event.model,
            tools: event.tools,
            permissionMode: event.permissionMode,
          })
        }
        if (!active.stopping) this.#publishFastNotice(this.#flags.observeInit(event.fastMode))
        return
      }
      case "mode":
        followReportedMode(active, event.permissionMode, "status", this.#emitModeEvent)
        return
      case "result":
        this.#publish(event)
        active.turns.observe(event)
        return
      case "error":
        active.turns.observe(event)
        break
      case "ended":
        active.pending.rejectAll("会话已结束")
        if (active.stopping) active.turns.end("interrupted", "SESSION_CANCELLED")
        else active.turns.end("error", "SDK_ERROR")
        this.#publish(sanitizeSessionEvent(event, this.#options.sessionToken()))
        if (!active.stopping) void this.release()
        return
      case "message":
        active.subagents.observe(event.subagent)
        this.#publish(this.#reply.observe(event))
        for (const workflow of active.workflows.called(event)) this.#publish(workflow)
        return
      case "tool-result":
        active.subagents.observe(event.subagent)
        this.#publish(this.#reply.observe(event))
        this.#publishWorkflow(active.workflows.toolResult(event))
        return
      default:
        this.#publish(this.#reply.observe(event))
        return
    }
    this.#publish(sanitizeSessionEvent(event, this.#options.sessionToken()))
  }

  #handleTurnClosed(turn: ClosedTurn): void {
    const active = this.state
    if (!active.stopping && !active.released) {
      void active.checkpoint?.(active.environment.workspace, "final", turn.turnId)
    }
    const record = buildUsageRecord(active, turn, this.#options.now())
    active.switchedFrom = null
    this.#options.recordUsage(record)
  }

  #handleAnswerTimeout(kind: PendingAnswerKind): void {
    const active = this.state
    if (active.released) return
    this.#stall.stop()
    const [code, message] =
      kind === "question"
        ? (["QUESTION_TIMEOUT", "提问超时"] as const)
        : (["PERMISSION_TIMEOUT", "权限询问超时"] as const)
    this.#publish({ type: "error", code, message })
    // 同一 turn 的其它权限卡片和提问不能继续悬挂。
    active.pending.rejectAll(message)
    void active.turns.interrupt("error", code)
  }

  // 没有正常结束的一轮里，界面上已经流出、却没落成消息的正文补成一条消息，结束后不会消失。
  #publishTurn(event: SessionTurnEvent): void {
    if (event.type === "turn-started") this.#stall.start()
    else this.#stall.stop()
    const unfinished = this.#reply.takeUnfinished()
    if (event.type === "turn-ended") this.#flags.ended(event.turnId)
    if (event.type === "turn-ended" && event.status !== "completed" && unfinished !== null) {
      this.#publish({
        type: "message",
        messageId: `unfinished-${event.turnId}`,
        model: this.state.model ?? "",
        subagent: null,
        blocks: [{ type: "text", text: unfinished }],
      })
    }
    this.#publish(event)
  }

  #publish(event: SessionHostEvent): void {
    this.#options.emit(this.#log.append(event))
  }

  #publishWorkflow(event: WorkflowEvent | null): void {
    if (event !== null) this.#publish(event)
  }

  #publishFastNotice(key: FastModeNoticeKey | null): void {
    if (key !== null) this.#publish({ type: "notice", key, level: "warning", params: {} })
  }

  #redact(message: string): string {
    return redactSessionToken(message, this.#options.sessionToken())
  }
}
