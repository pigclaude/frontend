// 定义桌面调度服务、会话入口和定时任务页共用的数据。

import type { ScheduleRule, ScheduleRunStatus, WorktreeStart } from "@pigclaude/ui-contracts"
import type { SessionEffort } from "./main/session/session-types"

/** 定时会话支持的四个权限档。 */
export type ScheduledTaskPermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions"

/** 本机保存的任务配置。endsAt 是界面按本机日期选出的结束时刻。 */
export type ScheduledTaskInput = {
  projectPath: string
  title?: string | undefined
  prompt: string
  /** 保存输入框里的文件标记，执行时使用 prompt 的纯文本。 */
  draft?: { document: string } | null | undefined
  rule: ScheduleRule
  endsAt: string | null
  enabled: boolean
  model: string | null
  permissionMode: ScheduledTaskPermissionMode
  accountId: string | null
  effort?: SessionEffort | undefined
  fast?: boolean | undefined
  /** 每次触发从所选 ref 新建独立工作树。 */
  worktree?: WorktreeStart | undefined
}

/** 定时任务允许的最短重复间隔。 */
export const minimumScheduledTaskMinutes = 15

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
  /** 该任务的持久触发序号，历史排序不受本机墙钟调整影响。 */
  triggerSequence: number
  source: "schedule" | "manual"
  status: ScheduleRunStatus
  scheduledAt: string | null
  triggeredAt: string
  finishedAt: string | null
  reason: string | null
  sessionId: string | null
  accountId: string | null
  deniedApprovals: number
  /** 本次终态已由现场会话信封通知时为 true。 */
  sessionNoticeHandled?: boolean | undefined
}

/** 会话入口返回一次运行的最终结果。reason 用稳定代码交给界面和通知。 */
export type ScheduledTaskOutcome = {
  status: Exclude<ScheduleRunStatus, "running">
  reason?: string | null
  sessionId?: string | null
  accountId?: string | null
  deniedApprovals?: number
  /** 本次确有终态信封时标记，避免调度观察者重复通知。 */
  sessionNoticeHandled?: boolean | undefined
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

/** 定时任务主进程与预加载共用的 IPC 命名前缀。 */
export const scheduledTaskChannelPrefix = "pigclaude:scheduled-tasks-"

/** 调度数据落盘后发送的无正文刷新事件。 */
export const scheduledTasksChangedChannel = scheduledTaskChannelPrefix + "changed"

/** 定时任务页使用的本机调度命令。保存返回 null 表示用户取消完全访问确认。 */
export type ScheduledTasksBridge = {
  list: () => Promise<ScheduledTask[]>
  create: (input: ScheduledTaskInput) => Promise<ScheduledTask | null>
  update: (id: string, input: ScheduledTaskInput) => Promise<ScheduledTask | null>
  setEnabled: (id: string, enabled: boolean) => Promise<ScheduledTask>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<ScheduledTaskRun>
  runs: (id: string, offset: number, limit: number) => Promise<ScheduledTaskRunsPage>
  removeRun: (taskId: string, runId: string) => Promise<void>
  subscribe: (listener: () => void) => () => void
}
