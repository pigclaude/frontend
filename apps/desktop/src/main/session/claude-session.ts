// 负责一个 Claude 会话的运行：发送、取消、权限和提问的回答、模式和模型切换、结束，以及把适配器事件变成会话事件和用量记录。
// 回合开闭交给 SessionTurns；发出的事件都经这个会话自己的事件日志盖上时间和序号。
// 只依赖这一个会话的适配器、事件出口、时钟和定时器，不引用会话宿主或模块级单例。

import type { DevProviderOverride } from "./dev-provider"
import type { PendingAnswerKind } from "./pending-answers"
import { cancelledPermissionMessage, type PermissionAnswer } from "./permission-broker"
import type { QuestionAnswer } from "./question-broker"
import type { SessionEnvelope } from "./session-envelope"
import { classifyDaemonError } from "./session-error-mapping"
import { LiveReply } from "./live-reply"
import { SessionEventLog } from "./session-event-log"
import { createActiveSession, type ActiveSession, type SessionTimers } from "./session-host-active"
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
import type { AdapterEvent } from "./session-events"
import type { ClosedTurn } from "./session-turns"
import type {
  SessionAdapterFactory,
  SessionEnvironmentPort,
  SessionHostEvent,
  SessionPermissionMode,
  SessionRuntimeEvent,
  SessionSendInput,
  SessionStartInput,
  SessionStatusView,
  SessionTurnEvent,
} from "./session-types"
import type { UsageRecord } from "./usage-recorder"

/** 构造一个会话所需的全部依赖；都只属于这一个会话。 */
export type ClaudeSessionOptions = {
  sessionId: string
  /** 已按开发期供应商固定过模型的启动输入。 */
  input: SessionStartInput
  environment: SessionEnvironmentPort
  createAdapter: SessionAdapterFactory
  /** 事件出口；收到的事件都已脱敏，并已盖上这个会话的时间和序号。 */
  emit: (envelope: SessionEnvelope) => void
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

/** 一个 Claude 会话。保证结束路径只走一次；释放后忽略迟到的适配器事件和权限超时；发出的事件时间不倒退、序号连续。 */
export class ClaudeSession {
  readonly state: ActiveSession
  readonly #options: ClaudeSessionOptions
  readonly #log: SessionEventLog
  readonly #reply: LiveReply
  readonly #emitModeEvent = (event: ModeEvent): void => {
    if (event.type === "mode") this.#publish(event)
    else this.#publish({ ...event, message: this.#redact(event.message) })
  }

  /** 组装会话状态、事件日志、待答队列、权限和提问代理以及适配器；不启动 Claude Code。 */
  constructor(options: ClaudeSessionOptions) {
    this.#options = options
    this.#log = new SessionEventLog(options.sessionId, options.now)
    this.#reply = new LiveReply(options.now)
    this.state = createActiveSession(options.sessionId, options.input, options.environment, {
      createAdapter: options.createAdapter,
      permissionTimeoutMs: options.permissionTimeoutMs,
      timers: options.timers,
      now: options.now,
      emitPermission: (request) => this.#publish(request),
      emitQuestion: (event) => this.#publish(event),
      emitTurn: (event) => this.#publishTurn(event),
      onTurnClosed: (_active, turn) => this.#handleTurnClosed(turn),
      onAnswerTimeout: (_active, kind) => this.#handleAnswerTimeout(kind),
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
    this.#publish({ type: "mode", permissionMode: this.state.permissionMode })
  }

  /**
   * 写入一条消息，被接受后开一轮；如有工作台回调，在交给适配器之前记录基线。
   * 上一轮（含它的后台子代理和工作流）没结束时抛 SESSION_ALREADY_ACTIVE。
   */
  async send(input: SessionSendInput, checkpoint?: ActiveSession["checkpoint"]): Promise<void> {
    const active = this.state
    const turnId = active.turns.reserve(this.#options.newId)
    active.checkpoint = checkpoint
    try {
      await checkpoint?.(active.environment.workspace, "baseline")
      if (!active.turns.holds(turnId)) return
      if (active.stopping || active.released) {
        active.turns.release(turnId)
        return
      }
      await active.adapter.send(input.text)
    } catch (error) {
      active.turns.release(turnId)
      const message = errorMessage(error)
      const code = classifyDaemonError(message) ?? "SDK_ERROR"
      throw hostError(code, message, this.#options.sessionToken())
    }
    active.turns.open(turnId)
  }

  /** 停止当前一轮：拒绝未回答的权限和提问，中断并停止在途后台任务，以中断结束这一轮；会话保留供下一次发送。 */
  async cancel(): Promise<void> {
    const active = this.state
    active.pending.rejectAll("用户已取消")
    await active.turns.interrupt("interrupted", "SESSION_CANCELLED")
  }

  /** 写回一次权限回答；未知 requestId 由 PermissionBroker 忽略。 */
  respondPermission(answer: PermissionAnswer): void {
    this.state.broker.respond(answer)
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
  }

  /**
   * 结束会话：拒绝权限和提问，再中断并停止在途后台任务（会员失效时直接中止并报错），以中断结束进行中的一轮，
   * 然后停止适配器、清理环境。重复调用返回同一个 Promise。
   */
  end(rejectMessage: string, errorCode: "MEMBERSHIP_REQUIRED" | null): Promise<void> {
    const active = this.state
    if (active.ending !== null) return active.ending
    active.stopping = true
    active.ending = (async () => {
      active.pending.rejectAll(rejectMessage)
      if (errorCode !== null) {
        this.#publish({ type: "error", code: errorCode, message: rejectMessage })
        active.abort.abort()
        active.turns.end("interrupted", errorCode)
      } else {
        await active.turns.shutdown()
      }
      await active.adapter.stop().catch(() => undefined)
      await this.release()
    })()
    return active.ending
  }

  /** 拒绝还没回答的权限和提问，释放会话环境；可重复调用，只在第一次通知宿主。 */
  async release(): Promise<void> {
    const active = this.state
    if (active.released) return
    active.released = true
    active.pending.rejectAll(cancelledPermissionMessage)
    this.#options.onReleased(this)
    await active.environment.cleanup().catch(() => undefined)
  }

  /**
   * 记录换号：只有 turn 进行中的换号才记入用量，并广播换号事件。
   * 第一次选号没有用上偏好的账号时，再发一条提示说明已经换用别的账号。
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
    switch (event.type) {
      case "background-tasks":
      case "background-task-started":
      case "background-task-ended":
        active.turns.observe(event)
        return
      case "subagent-task-started":
        active.subagents.started(event)
        return
      case "subagent-task-ended": {
        const ended = active.subagents.ended(event)
        if (ended !== null) this.#publish(ended)
        return
      }
      case "started":
        active.model = event.model
        active.turns.observe(event)
        followReportedMode(active, event.permissionMode, "init", this.#emitModeEvent)
        break
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
      default:
        this.#publish(this.#reply.observe(event))
        return
    }
    this.#publish(sanitizeSessionEvent(event, this.#options.sessionToken()))
  }

  #handleTurnClosed(turn: ClosedTurn): void {
    const active = this.state
    if (!active.stopping && !active.released) {
      void active.checkpoint?.(active.environment.workspace, "final")
    }
    const record = buildUsageRecord(active, turn, this.#options.now())
    active.switchedFrom = null
    this.#options.recordUsage(record)
  }

  #handleAnswerTimeout(kind: PendingAnswerKind): void {
    const active = this.state
    if (active.released) return
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
    const unfinished = this.#reply.takeUnfinished()
    if (event.type === "turn-ended" && event.status !== "completed" && unfinished !== null) {
      this.#publish({
        type: "message",
        messageId: `unfinished-${event.turnId}`,
        model: this.state.model ?? "",
        parentToolUseId: null,
        blocks: [{ type: "text", text: unfinished }],
      })
    }
    this.#publish(event)
  }

  #publish(event: SessionHostEvent): void {
    this.#options.emit(this.#log.append(event))
  }

  #redact(message: string): string {
    return redactSessionToken(message, this.#options.sessionToken())
  }
}
