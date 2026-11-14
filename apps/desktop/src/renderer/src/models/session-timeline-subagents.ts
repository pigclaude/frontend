// 负责投影里一轮的子代理卡：Task/Agent 工具调用成为子代理卡，卡片在子代理结束事件到达时完成，
// 交回的结果取任务通知里的摘要。后台子代理的工具结果只说明已在后台启动，不算完成；工具结果报错时
// 子代理没有起来，按失败结束。一轮结束时还没完成的卡片按这一轮的结束方式收尾。

import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionTurn } from "./session-model"

type ToolResultEvent = Extract<SessionHostEvent, { type: "tool-result" }>
type SubagentEndedEvent = Extract<SessionHostEvent, { type: "subagent-ended" }>

/** 子代理卡的完成状态，和对话组件的子代理状态一致。 */
type CardStatus = "completed" | "failed" | "interrupted"

/** subagent.completed 的 payload。 */
export type SubagentCompletion = {
  toolCallId: string
  output: string
  isError: boolean
  status: CardStatus
}

/** Task 和 Agent 工具调用画成子代理卡。 */
export function isSubagentTool(name: string): boolean {
  return name === "Task" || name === "Agent"
}

/** subagent.started 的 payload：类型、任务说明和完整任务取自工具输入。 */
export function subagentStartPayload(id: string, input: unknown): Record<string, unknown> {
  const fields = (input ?? {}) as Record<string, unknown>
  return {
    toolCallId: id,
    name: typeof fields.subagent_type === "string" ? fields.subagent_type : "子代理",
    ...(typeof fields.description === "string" ? { description: fields.description } : {}),
    ...(typeof fields.prompt === "string" ? { prompt: fields.prompt } : {}),
  }
}

/** 一轮里的子代理卡。保证每张卡只完成一次。 */
export class SubagentCards {
  readonly #all = new Set<string>()
  /** 还没完成的卡，记着它的工具结果（前台子代理交回的结果，后台子代理的启动说明）。 */
  readonly #open = new Map<string, string | null>()

  /** 一张卡开始运行。 */
  start(id: string): void {
    this.#all.add(id)
    this.#open.set(id, null)
  }

  /** 这个工具调用是不是这一轮的子代理卡（不论是否已完成）。 */
  owns(id: string): boolean {
    return this.#all.has(id)
  }

  /** 子代理工具的结果：报错时按失败完成这张卡，否则只记下结果，等子代理结束事件。 */
  toolResult(event: ToolResultEvent): SubagentCompletion | null {
    if (!this.#open.has(event.toolUseId)) return null
    if (!event.isError) {
      this.#open.set(event.toolUseId, event.content)
      return null
    }
    return this.#complete(event.toolUseId, event.content, "failed")
  }

  /** 子代理结束事件：完成这张卡，交回的结果是任务通知里的摘要。不是这一轮的卡时返回 null。 */
  ended(event: SubagentEndedEvent): SubagentCompletion | null {
    if (!this.#open.has(event.parentToolUseId)) return null
    const status: CardStatus =
      event.status === "stopped"
        ? "interrupted"
        : event.status === "failed"
          ? "failed"
          : "completed"
    return this.#complete(event.parentToolUseId, event.summary, status)
  }

  /** 一轮结束时收尾还没完成的卡：正常结束的一轮按完成，结果取工具结果；其他按中断。 */
  settle(status: SessionTurn["status"]): SubagentCompletion[] {
    return [...this.#open].map(([id, output]) =>
      status === "done"
        ? this.#complete(id, output ?? "", "completed")
        : this.#complete(id, "", "interrupted"),
    )
  }

  #complete(id: string, output: string, status: CardStatus): SubagentCompletion {
    this.#open.delete(id)
    return { toolCallId: id, output, isError: status === "failed", status }
  }
}
