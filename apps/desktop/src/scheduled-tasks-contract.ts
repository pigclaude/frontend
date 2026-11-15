// 定义桌面调度服务、会话入口和设置页共用的定时任务数据。

import type { ScheduleRule, ScheduleRunStatus } from "@pigclaude/ui-contracts"

/** 定时会话支持的四个权限档。 */
export type ScheduledTaskPermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions"

/** 本机保存的任务配置。endsAt 是界面按本机日期选出的结束时刻。 */
export type ScheduledTaskInput = {
  projectPath: string
  prompt: string
  rule: ScheduleRule
  endsAt: string | null
  enabled: boolean
  model: string | null
  permissionMode: ScheduledTaskPermissionMode
  accountId: string | null
}

/** 配置及调度状态。runCount 统计包含跳过在内的触发次数。 */
export type ScheduledTask = ScheduledTaskInput & {
  id: string
  nextRunAt: string | null
  lastRunAt: string | null
  lastSessionId: string | null
  runCount: number
}

/** 一次持久化的触发记录。立即运行的 scheduledAt 为 null。 */
export type ScheduledTaskRun = {
  id: string
  taskId: string
  source: "schedule" | "manual"
  status: ScheduleRunStatus
  scheduledAt: string | null
  triggeredAt: string
  finishedAt: string | null
  reason: string | null
  sessionId: string | null
  accountId: string | null
  deniedApprovals: number
}

/** 会话入口返回一次运行的最终结果。reason 用稳定代码交给界面和通知。 */
export type ScheduledTaskOutcome = {
  status: Exclude<ScheduleRunStatus, "running">
  reason?: string | null
  sessionId?: string | null
  accountId?: string | null
  deniedApprovals?: number
}

/** 托盘和退出确认可直接使用的任务摘要。 */
export type ScheduledTaskSummaryItem = Pick<
  ScheduledTask,
  "id" | "projectPath" | "nextRunAt" | "lastRunAt"
>

/** 托盘显示下一次触发。退出确认读取启用任务。 */
export type ScheduledTaskSummary = {
  next: ScheduledTaskSummaryItem | null
  enabled: ScheduledTaskSummaryItem[]
}

/** 持久化更改后通知订阅者。运行事件只携带记录。 */
export type ScheduledTaskChange = { type: "tasks" } | { type: "run"; run: ScheduledTaskRun }

/** 按触发倒序读取一页本机运行记录。 */
export type ScheduledTaskRunsPage = { runs: ScheduledTaskRun[]; total: number }
