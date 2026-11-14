// 负责一个会话里的子代理任务：从任务开始和任务通知消息读出子代理信号，记下每个子代理的 agent id
// 是哪一次 Agent 工具调用派生的，并在子代理的任务通知到达时得出 subagent-ended 事件。
// 后台子代理的工具结果只说明已在后台启动，它要等任务通知才算结束。

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { SubagentOwner } from "./session-events"

/** 子代理结束的方式，取自任务通知：正常完成、失败，或被停止。 */
export type SubagentEndStatus = "completed" | "failed" | "stopped"

/** 适配器从 SDK 任务消息读出的子代理信号；只在主进程内部使用，不发给渲染层。 */
export type SubagentTaskSignal =
  /** 一个子代理开始了：agent id 是它的任务 id，parentToolUseId 是派生它的 Agent 工具调用。 */
  | { type: "subagent-task-started"; agentId: string; parentToolUseId: string }
  /** 一个任务结束了；不一定是子代理，会话据它开始时的信号判断。 */
  | { type: "subagent-task-ended"; agentId: string; status: SubagentEndStatus; summary: string }

/** 子代理结束事件：它的归属、结束方式和交回的结果（任务通知里的摘要）。 */
export type SubagentEndedEvent = {
  type: "subagent-ended"
  parentToolUseId: string
  agentId: string
  status: SubagentEndStatus
  summary: string
}

const subagentTaskTypes = new Set(["local_agent", "remote_agent"])

/** 把一条 SDK 消息读成子代理信号；不是子代理的任务开始、也不是任务通知时返回 null。 */
export function readSubagentTaskSignal(message: SDKMessage): SubagentTaskSignal | null {
  if (message.type !== "system") return null
  switch (message.subtype) {
    case "task_started":
      if (message.task_type === undefined || !subagentTaskTypes.has(message.task_type)) return null
      if (message.tool_use_id === undefined) return null
      return {
        type: "subagent-task-started",
        agentId: message.task_id,
        parentToolUseId: message.tool_use_id,
      }
    case "task_notification":
      return {
        type: "subagent-task-ended",
        agentId: message.task_id,
        status: message.status,
        summary: message.summary,
      }
    default:
      return null
  }
}

/** 一个会话的子代理。保证只为开始过的子代理发出结束事件，并能按 agent id 找回它的归属。 */
export class SubagentTasks {
  readonly #parents = new Map<string, string>()

  /** 记下一个开始了的子代理。 */
  started(signal: Extract<SubagentTaskSignal, { type: "subagent-task-started" }>): void {
    this.#parents.set(signal.agentId, signal.parentToolUseId)
  }

  /** 任务结束：是子代理时得出结束事件，其他任务（例如子代理起的后台 shell）返回 null。 */
  ended(
    signal: Extract<SubagentTaskSignal, { type: "subagent-task-ended" }>,
  ): SubagentEndedEvent | null {
    const parentToolUseId = this.#parents.get(signal.agentId)
    if (parentToolUseId === undefined) return null
    return {
      type: "subagent-ended",
      parentToolUseId,
      agentId: signal.agentId,
      status: signal.status,
      summary: signal.summary,
    }
  }

  /** 按 agent id 找回子代理归属；主线程（没有 agent id）或不认识的 agent id 只留下已知的部分。 */
  owner(agentId: string | undefined): SubagentOwner {
    if (agentId === undefined) return {}
    const parentToolUseId = this.#parents.get(agentId)
    return parentToolUseId === undefined ? { agentId } : { parentToolUseId, agentId }
  }
}
