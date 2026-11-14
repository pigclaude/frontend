// 负责把 SDK 的任务开始、任务进度和任务通知消息读成任务信号，供子代理和工作流共用。
// 回合等不等后台任务另由后台任务变化消息决定，见 background-tasks.ts。

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { WorkflowSnapshot } from "@pigclaude/ui-contracts"
import { readWorkflowProgress, withoutUndefined, type WorkflowProgress } from "./workflow-progress"

/** 任务结束的方式，取自任务通知：正常完成、失败，或被停止。 */
export type TaskEndStatus = "completed" | "failed" | "stopped"

/** 任务的用量：总 token、工具调用次数和耗时；CLI 没给的项省略。 */
export type TaskUsage = NonNullable<WorkflowSnapshot["usage"]>

/** 适配器从 SDK 任务消息读出的信号；只在主进程内部使用，不发给渲染层。 */
export type TaskSignal =
  /** 一个任务开始了：toolUseId 是派生它的工具调用；工作流还带脚本里的名字。 */
  | {
      type: "task-started"
      taskId: string
      taskType: string | null
      toolUseId: string | null
      description: string | null
      workflowName: string | null
    }
  /** 任务进度：用量，以及工作流的阶段和 agent（只有部分进度消息带）。 */
  | {
      type: "task-progress"
      taskId: string
      usage: TaskUsage | null
      workflowProgress: WorkflowProgress | null
    }
  /** 一个任务结束了；不一定是子代理或工作流，由开始时的信号判断。 */
  | {
      type: "task-ended"
      taskId: string
      status: TaskEndStatus
      summary: string
      usage: TaskUsage | null
    }

/** 把一条 SDK 消息读成任务信号；不是任务开始、进度或通知消息时返回 null。 */
export function readTaskSignal(message: SDKMessage): TaskSignal | null {
  if (message.type !== "system") return null
  switch (message.subtype) {
    case "task_started":
      return {
        type: "task-started",
        taskId: message.task_id,
        taskType: message.task_type ?? null,
        toolUseId: message.tool_use_id ?? null,
        description: message.description,
        workflowName: message.workflow_name ?? null,
      }
    case "task_progress":
      return {
        type: "task-progress",
        taskId: message.task_id,
        usage: readTaskUsage(message.usage),
        workflowProgress: readWorkflowProgress(message),
      }
    case "task_notification":
      return {
        type: "task-ended",
        taskId: message.task_id,
        status: message.status,
        summary: message.summary,
        usage: readTaskUsage(message.usage),
      }
    default:
      return null
  }
}

type SdkTaskUsage = { total_tokens: number; tool_uses: number; duration_ms: number }

function readTaskUsage(usage: SdkTaskUsage | undefined): TaskUsage | null {
  if (usage === undefined) return null
  return withoutUndefined({
    tokens: count(usage.total_tokens),
    toolCalls: count(usage.tool_uses),
    durationMs: count(usage.duration_ms),
  })
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
