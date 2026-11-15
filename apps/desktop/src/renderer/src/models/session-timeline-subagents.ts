// 负责投影里一轮的子代理：主线程的 Task/Agent 工具调用成为子代理卡；子代理自己的思考、正文和工具
// 调用带上父工具调用 id，只进它的卡，不进主时间线。卡片在子代理结束事件到达时完成，交回的结果取
// 任务通知里的摘要；后台子代理的工具结果只说明已在后台启动，不算完成；工具结果报错时子代理没有
// 起来，按失败结束。一轮结束时还没等到结束事件的卡：前台子代理按交回的工具结果完成，后台子代理
// 没有结果、按中断收尾。

import type { ThreadEvent } from "@pigclaude/ui-contracts"
import { maskBrowserSecrets } from "../../../main/session/session-browser-secrets"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { sessionToolOutput } from "./session-tool-output"

type MessageEvent = Extract<SessionHostEvent, { type: "message" }>
type ToolResultEvent = Extract<SessionHostEvent, { type: "tool-result" }>
type SubagentEndedEvent = Extract<SessionHostEvent, { type: "subagent-ended" }>

/** 往一轮里追加一条线程事件；at 是事件的 ISO UTC 时间。 */
export type PushDraft = (type: ThreadEvent["type"], payload: unknown, at: string) => void

/** 子代理卡的完成状态，和对话组件的子代理状态一致。 */
type CardStatus = "completed" | "failed" | "interrupted"

/** 一轮里的子代理卡。保证每张卡只完成一次，子代理的每个块和每个工具只投影一次。 */
export class SubagentCards {
  readonly #push: PushDraft
  readonly #all = new Set<string>()
  readonly #running = new Set<string>()
  readonly #handBacks = new Map<string, string>()
  readonly #blocks = new Set<string>()
  readonly #tools = new Map<string, string>()
  readonly #finished = new Set<string>()

  /** 投影出的事件都经 push 追加到这一轮。 */
  constructor(push: PushDraft) {
    this.#push = push
  }

  /** 主线程的工具调用：是 Task 或 Agent 时开一张子代理卡并返回 true，其他工具返回 false。 */
  start(id: string, name: string, input: unknown, at: string): boolean {
    if (name !== "Task" && name !== "Agent") return false
    this.#all.add(id)
    this.#running.add(id)
    const fields = (input ?? {}) as Record<string, unknown>
    this.#push(
      "subagent.started",
      {
        toolCallId: id,
        name: typeof fields.subagent_type === "string" ? fields.subagent_type : "子代理",
        ...(typeof fields.description === "string" ? { description: fields.description } : {}),
        ...(typeof fields.prompt === "string" ? { prompt: fields.prompt } : {}),
      },
      at,
    )
    return true
  }

  /**
   * 主线程的工具结果：属于子代理卡时处理掉并返回 true，否则返回 false。报错时按失败完成；前台子代理
   * 交回的结果先记下，等结束事件或这一轮结束。
   */
  toolResult(event: ToolResultEvent, at: string): boolean {
    if (!this.#all.has(event.toolUseId)) return false
    if (event.isError) this.#complete(event.toolUseId, event.content, "failed", at)
    else if (event.backgroundLaunch !== true) this.#handBacks.set(event.toolUseId, event.content)
    return true
  }

  /** 子代理结束事件：完成它的卡，交回的结果是任务通知里的摘要；不是这一轮的卡时忽略。 */
  ended(event: SubagentEndedEvent, at: string): void {
    const status: CardStatus =
      event.status === "stopped"
        ? "interrupted"
        : event.status === "failed"
          ? "failed"
          : "completed"
    this.#complete(event.parentToolUseId, event.summary, status, at)
  }

  /** 子代理自己的消息或工具结果：带上父工具调用 id 进它的卡；认不出父工具调用时不显示。 */
  owned(event: MessageEvent | ToolResultEvent, at: string): void {
    const parentToolUseId = event.subagent?.parentToolUseId
    if (parentToolUseId == null) return
    if (event.type === "tool-result") {
      if (this.#finished.has(event.toolUseId)) return
      this.#finished.add(event.toolUseId)
      const { toolUseId: toolCallId, isError } = event
      const output = sessionToolOutput(event, this.#tools.get(toolCallId))
      this.#push("tool.completed", { toolCallId, output, isError, parentToolUseId }, at)
      return
    }
    for (const block of event.blocks) {
      if (block.type === "tool-use") {
        if (this.#tools.has(block.id)) continue
        this.#tools.set(block.id, block.name)
        const payload = {
          toolCallId: block.id,
          name: block.name,
          input: maskBrowserSecrets(block.name, block.input),
        }
        this.#push("tool.started", { ...payload, parentToolUseId }, at)
        continue
      }
      const key = `${event.messageId}\u0000${block.type}\u0000${block.text}`
      if (block.text === "" || this.#blocks.has(key)) continue
      this.#blocks.add(key)
      const type = block.type === "thinking" ? "reasoning.completed" : "message.completed"
      this.#push(type, { text: block.text, parentToolUseId }, at)
    }
  }

  /** 一轮结束：还没等到结束事件的卡，有交回的结果时按完成，否则没有结果、按中断收尾。 */
  settle(at: string): void {
    for (const id of [...this.#running]) {
      const handBack = this.#handBacks.get(id)
      if (handBack === undefined) this.#complete(id, "", "interrupted", at)
      else this.#complete(id, handBack, "completed", at)
    }
  }

  #complete(id: string, output: string, status: CardStatus, at: string): void {
    if (!this.#running.delete(id)) return
    const payload = { toolCallId: id, output, isError: status === "failed", status }
    this.#push("subagent.completed", payload, at)
  }
}
