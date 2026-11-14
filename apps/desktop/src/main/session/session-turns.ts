// 负责一个会话的回合开闭：发送被接受时开一轮；收到 result 且没有在途的后台子代理和工作流时结束；
// 停止时先中断，再逐个停止在途后台任务，然后以中断结束这一轮。每轮用量取结束时和开始时会话累计用量的差值。
// 只依赖这一个会话的适配器、事件出口和时钟，不引用会话宿主。

import { BackgroundTasks } from "./background-tasks"
import type { AdapterEvent, SessionUsage } from "./session-events"
import {
  SessionHostError,
  type SessionAdapterPort,
  type SessionTurnEndStatus,
  type SessionTurnEvent,
} from "./session-types"

/** 一轮结束时交给会话的结果；用量是这一轮的差值，含子代理和工作流。 */
export type ClosedTurn = {
  turnId: string
  status: SessionTurnEndStatus
  errorCode: string | null
  usage: SessionUsage
  durationMs: number
}

/** 回合控制的依赖；都只属于这一个会话。 */
export type SessionTurnsOptions = {
  adapter: Pick<SessionAdapterPort, "interrupt" | "stopTask">
  publish: (event: SessionTurnEvent) => void
  onClosed: (turn: ClosedTurn) => void
  now: () => number
}

type OpenTurn = {
  id: string
  startedAt: number
  baseline: SessionUsage
  errorCode: string | null
  resultError: boolean
  stopping: boolean
}

const noUsage: SessionUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
})

/**
 * 一个会话的回合。保证同一时刻最多一轮；每个 turn-started 恰好对应一个 turn-ended；
 * 各轮用量相加等于已结束各轮覆盖的累计用量，停止后迟到的用量计入下一轮，不丢也不重复。
 */
export class SessionTurns {
  readonly #options: SessionTurnsOptions
  readonly #tasks = new BackgroundTasks()
  #reserved: string | null = null
  #open: OpenTurn | null = null
  #total: SessionUsage = noUsage
  #accounted: SessionUsage = noUsage
  #stopping: Promise<void> | null = null

  /** 创建空闲的回合控制。 */
  constructor(options: SessionTurnsOptions) {
    this.#options = options
  }

  /** 进行中或正在发送的一轮；空闲时为 null。 */
  get turnId(): string | null {
    return this.#open?.id ?? this.#reserved
  }

  /** 为一次发送占住回合并返回新一轮的 id；已有一轮进行中时抛 SESSION_ALREADY_ACTIVE，不生成 id。 */
  reserve(newId: () => string): string {
    if (this.turnId !== null) {
      throw new SessionHostError("SESSION_ALREADY_ACTIVE", "当前请求尚未结束")
    }
    const turnId = newId()
    this.#reserved = turnId
    return turnId
  }

  /** 占位还在：发送前没有被停止。 */
  holds(turnId: string): boolean {
    return this.#reserved === turnId
  }

  /** 发送没有被接受时放开占位。 */
  release(turnId: string): void {
    if (this.#reserved === turnId) this.#reserved = null
  }

  /** 发送已被接受：开一轮并发出 turn-started。 */
  open(turnId: string): void {
    this.#reserved = null
    this.#open = {
      id: turnId,
      startedAt: this.#options.now(),
      baseline: this.#accounted,
      errorCode: null,
      resultError: false,
      stopping: false,
    }
    this.#options.publish({ type: "turn-started", turnId })
  }

  /** 看一条适配器事件：跟踪后台任务和累计用量，result 到达且没有在途后台任务时结束这一轮。 */
  observe(event: AdapterEvent): void {
    switch (event.type) {
      case "background-tasks":
      case "background-task-started":
      case "background-task-ended":
        this.#tasks.apply(event)
        return
      case "result": {
        this.#total = event.totalUsage ?? addUsage(this.#total, event.usage)
        const open = this.#open
        if (open === null || open.stopping) return
        open.resultError = event.isError
        if (this.#tasks.running().length === 0) this.#closeFinished(open)
        return
      }
      case "error":
        if (this.#open !== null && !this.#open.stopping) this.#open.errorCode = event.code
        return
      default:
        return
    }
  }

  /**
   * 停止：放开发送占位，先中断，再逐个停止在途后台任务，然后以给定的状态和原因结束进行中的一轮。
   * 停止期间到达的 result 只计入用量，不结束这一轮。并发调用共享同一次停止。
   */
  stop(status: SessionTurnEndStatus, errorCode: string): Promise<void> {
    if (this.#stopping !== null) return this.#stopping
    this.#reserved = null
    const open = this.#open
    if (open !== null) open.stopping = true
    const task = (async () => {
      await this.#options.adapter.interrupt().catch(() => undefined)
      for (const taskId of this.#tasks.running()) {
        await this.#options.adapter.stopTask(taskId).catch(() => undefined)
      }
      if (open !== null && this.#open === open) this.#close(open, status, errorCode)
    })().finally(() => {
      this.#stopping = null
    })
    this.#stopping = task
    return task
  }

  /** 会话已经结束或不能再跑：不再中断，直接结束进行中的一轮；已记下的出错原因优先。 */
  end(status: SessionTurnEndStatus, errorCode: string): void {
    this.#reserved = null
    const open = this.#open
    if (open !== null) this.#close(open, status, open.errorCode ?? errorCode)
  }

  #closeFinished(open: OpenTurn): void {
    if (open.errorCode !== null || open.resultError) {
      this.#close(open, "error", open.errorCode ?? "SDK_ERROR")
    } else {
      this.#close(open, "completed", null)
    }
  }

  #close(open: OpenTurn, status: SessionTurnEndStatus, errorCode: string | null): void {
    const usage = subtractUsage(this.#total, open.baseline)
    this.#accounted = this.#total
    this.#open = null
    this.#options.publish({ type: "turn-ended", turnId: open.id, status, errorCode })
    this.#options.onClosed({
      turnId: open.id,
      status,
      errorCode,
      usage,
      durationMs: Math.max(0, this.#options.now() - open.startedAt),
    })
  }
}

function addUsage(left: SessionUsage, right: SessionUsage): SessionUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
  }
}

function subtractUsage(total: SessionUsage, baseline: SessionUsage): SessionUsage {
  return {
    inputTokens: Math.max(0, total.inputTokens - baseline.inputTokens),
    outputTokens: Math.max(0, total.outputTokens - baseline.outputTokens),
    cacheReadTokens: Math.max(0, total.cacheReadTokens - baseline.cacheReadTokens),
    cacheCreationTokens: Math.max(0, total.cacheCreationTokens - baseline.cacheCreationTokens),
  }
}
