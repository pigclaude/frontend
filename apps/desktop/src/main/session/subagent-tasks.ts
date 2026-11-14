// 负责一个会话里的子代理任务：从任务开始和任务通知信号记下每个子代理的 agent id 是哪一次 Agent
// 工具调用派生的，并在子代理的任务通知到达时得出 subagent-ended 事件。
// 后台子代理的工具结果只说明已在后台启动，它要等任务通知才算结束。

import type { SubagentRef } from "./session-events"
import type { TaskEndStatus, TaskSignal } from "./task-signals"

/** 子代理结束事件：它的归属、结束方式和交回的结果（任务通知里的摘要）。 */
export type SubagentEndedEvent = {
  type: "subagent-ended"
  parentToolUseId: string
  agentId: string
  status: TaskEndStatus
  summary: string
}

const subagentTaskTypes = new Set(["local_agent", "remote_agent"])

/** 由父工具调用 id 和 agent id 拼出归属；两者都没有时是主线程，返回 null。 */
export function subagentRef(
  parentToolUseId: string | null | undefined,
  agentId: string | null | undefined,
): SubagentRef | null {
  if (typeof parentToolUseId === "string") {
    return { parentToolUseId, agentId: typeof agentId === "string" ? agentId : null }
  }
  return typeof agentId === "string" ? { parentToolUseId: null, agentId } : null
}

/**
 * 一个会话的子代理。保证只为认出过的子代理发出结束事件，并能按 agent id 找回派生它的工具调用：
 * 子代理的任务开始消息和它自己的消息都会让会话认出它。
 */
export class SubagentTasks {
  readonly #parents = new Map<string, string>()

  /** 记下一个开始了的任务：只有带派生它的工具调用的子代理才记。 */
  started(signal: Extract<TaskSignal, { type: "task-started" }>): void {
    if (signal.taskType === null || !subagentTaskTypes.has(signal.taskType)) return
    if (signal.toolUseId !== null) this.#parents.set(signal.taskId, signal.toolUseId)
  }

  /** 从子代理自己的消息或工具结果记下它的归属；主线程或缺一半的归属不记。 */
  observe(subagent: SubagentRef | null): void {
    if (subagent?.parentToolUseId == null || subagent.agentId === null) return
    this.#parents.set(subagent.agentId, subagent.parentToolUseId)
  }

  /** 任务结束：是子代理时得出结束事件，其他任务（例如子代理起的后台 shell）返回 null。 */
  ended(signal: Extract<TaskSignal, { type: "task-ended" }>): SubagentEndedEvent | null {
    const parentToolUseId = this.#parents.get(signal.taskId)
    if (parentToolUseId === undefined) return null
    return {
      type: "subagent-ended",
      parentToolUseId,
      agentId: signal.taskId,
      status: signal.status,
      summary: signal.summary,
    }
  }

  /** 按 agent id 找回子代理归属：没有 agent id 是主线程；认不出的 agent id 仍归子代理，父工具调用为 null。 */
  refOf(agentId: string | undefined): SubagentRef | null {
    return subagentRef(agentId === undefined ? null : this.#parents.get(agentId), agentId)
  }
}
