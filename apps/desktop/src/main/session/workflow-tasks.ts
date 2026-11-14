// 负责一个会话里的工作流快照：主线程调用 Workflow 工具时先得出一份运行中的快照，任务开始、进度和
// 通知信号更新阶段、各个 agent 和结果。只在看得见的内容变化时得出新的 workflow 事件，token 和耗时
// 的跳动不算；任务结束总会得出一份。回合等不等工作流跑完由后台任务决定，这里不管。

import type { WorkflowAgent, WorkflowSnapshot, WorkflowStatus } from "@pigclaude/ui-contracts"
import type { SessionEvent } from "./session-events"
import type { TaskSignal } from "./task-signals"
import { readScriptMeta, withoutUndefined } from "./workflow-progress"

/** 工作流快照事件：界面按 toolCallId 合并成一张卡片；脚本只在第一份里带。 */
export type WorkflowEvent = { type: "workflow"; workflow: WorkflowSnapshot }

type MessageEvent = Extract<SessionEvent, { type: "message" }>
type ToolResultEvent = Extract<SessionEvent, { type: "tool-result" }>

const workflowTool = "Workflow"

/**
 * 一个会话的工作流。保证每个工作流的第一份快照带脚本、后面的不带；同一份可见内容不重复发出；
 * 只认主线程发起的工作流，其他任务的信号忽略。
 */
export class WorkflowTasks {
  readonly #snapshots = new Map<string, WorkflowSnapshot>()
  readonly #toolOfTask = new Map<string, string>()
  readonly #shown = new Map<string, string>()

  /** 主线程的一条消息：其中每个新的 Workflow 工具调用得出一份运行中的快照，名字和说明取自脚本。 */
  called(event: MessageEvent): WorkflowEvent[] {
    if (event.subagent !== null) return []
    const events: WorkflowEvent[] = []
    for (const block of event.blocks) {
      if (block.type !== "tool-use" || block.name !== workflowTool) continue
      if (this.#snapshots.has(block.id)) continue
      const input = block.input as { script?: unknown } | null
      const script = typeof input?.script === "string" ? input.script : undefined
      const snapshot = withoutUndefined({
        toolCallId: block.id,
        ...readScriptMeta(script),
        script,
        status: "running" as const,
        phases: [],
        agents: [],
      })
      this.#snapshots.set(block.id, snapshot)
      this.#shown.set(block.id, visible(snapshot))
      events.push({ type: "workflow", workflow: snapshot })
    }
    return events
  }

  /** 主线程的工具结果：Workflow 工具报错时工作流失败，原因是工具返回的文字；其他结果返回 null。 */
  toolResult(event: ToolResultEvent): WorkflowEvent | null {
    const current = this.#snapshots.get(event.toolUseId)
    if (event.subagent !== null || !event.isError || current === undefined) return null
    return this.#update({ ...current, status: "failed", summary: event.content }, true)
  }

  /** 任务信号：属于已知的工作流时更新快照，可见内容有变化或任务结束时返回事件。 */
  task(signal: TaskSignal): WorkflowEvent | null {
    if (signal.type === "task-started") {
      const current = signal.toolUseId === null ? undefined : this.#snapshots.get(signal.toolUseId)
      if (signal.toolUseId === null || current === undefined) return null
      this.#toolOfTask.set(signal.taskId, signal.toolUseId)
      return this.#update({
        ...current,
        taskId: signal.taskId,
        name: signal.workflowName ?? current.name,
        description: signal.description ?? current.description,
      })
    }
    const current = this.#snapshotOfTask(signal.taskId)
    if (current === undefined) return null
    const usage = signal.usage ?? current.usage
    if (signal.type === "task-progress") {
      return this.#update(withoutUndefined({ ...current, ...signal.workflowProgress, usage }))
    }
    const status: WorkflowStatus = signal.status
    const agents = current.agents.map((agent) => settle(agent, status))
    return this.#update(
      withoutUndefined({ ...current, status, agents, usage, summary: signal.summary }),
      true,
    )
  }

  #snapshotOfTask(taskId: string): WorkflowSnapshot | undefined {
    const toolCallId = this.#toolOfTask.get(taskId)
    return toolCallId === undefined ? undefined : this.#snapshots.get(toolCallId)
  }

  #update(next: WorkflowSnapshot, always = false): WorkflowEvent | null {
    const rest = { ...next }
    delete rest.script
    this.#snapshots.set(next.toolCallId, rest)
    const shown = visible(rest)
    if (!always && this.#shown.get(next.toolCallId) === shown) return null
    this.#shown.set(next.toolCallId, shown)
    return { type: "workflow", workflow: rest }
  }
}

// 工作流结束时还在跑的 agent 跟着整体收尾；被停止时保持原状，卡片把它们显示为已停止。
function settle(agent: WorkflowAgent, status: WorkflowStatus): WorkflowAgent {
  if (status === "stopped" || (agent.state !== "running" && agent.state !== "queued")) return agent
  return { ...agent, state: status === "completed" ? "done" : "failed" }
}

function visible(snapshot: WorkflowSnapshot): string {
  return JSON.stringify([
    snapshot.status,
    snapshot.name,
    snapshot.description,
    snapshot.summary,
    snapshot.phases,
    snapshot.agents.map(({ index, label, phase, state, prompt, activity, result }) => [
      index,
      label,
      phase,
      state,
      prompt,
      activity,
      result,
    ]),
  ])
}
