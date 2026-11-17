// 在本机调度配置和上游定时任务界面之间转换数据，只展示已登记的运行原因。

import type { Schedule, ScheduleExecution, ScheduleRun } from "@pigclaude/ui-contracts"
import type { CreateScheduleInput, RunNowResult } from "@pigclaude/ui-settings"
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunsPage,
} from "../../../scheduled-tasks-contract"
import { fill, type TextKey } from "../locale/text"
import {
  accountIdForAgent,
  agentIdForAccount,
  DEFAULT_PERMISSION_LEVEL,
  effortForComposer,
  permissionView,
  sessionPermissionMode,
} from "./composer-config"

/** 定时任务列表区分启用、暂停和规则已结束。 */
export type ScheduledTaskStatus = "active" | "paused" | "completed"

/** 根据实际排期区分已启用、有意暂停和不再有下一次触发。 */
export function taskStatus(task: ScheduledTask): ScheduledTaskStatus {
  if (!task.enabled) return "paused"
  return task.nextRunAt === null ? "completed" : "active"
}

const undated = new Date(0).toISOString()

/** 本机任务映射为项目任务，旧记录没有标题或 Compose 文档时仍可编辑。 */
export function scheduleView(task: ScheduledTask): Schedule {
  const execution: ScheduleExecution = {
    permissionMode: permissionView(task.permissionMode, DEFAULT_PERMISSION_LEVEL).level,
    ...(task.accountId || task.model
      ? { instanceId: agentIdForAccount(task.accountId ?? "") }
      : {}),
    ...(task.model ? { modelId: task.model } : {}),
    ...(task.effort ? { effort: task.effort } : {}),
    ...(task.fast ? { fast: true } : {}),
    ...(task.worktree ? { worktree: task.worktree } : {}),
  }
  return {
    id: task.id,
    target: { kind: "project", projectId: task.projectPath, execution },
    title: task.title ?? "",
    prompt: task.prompt,
    draft: task.draft ?? null,
    rule: task.rule,
    endsAt: task.endsAt,
    enabled: task.enabled,
    status: taskStatus(task),
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastRunId: task.lastSessionId,
    runCount: task.runCount,
    createdAt: undated,
    updatedAt: task.lastRunAt ?? undated,
  }
}

/** 编辑器提交的项目、时间和执行选项转换为本机无人值守任务。 */
export function nativeScheduleInput(
  input: Omit<CreateScheduleInput, "draft"> & {
    draft?: CreateScheduleInput["draft"] | null
  },
): ScheduledTaskInput {
  const { execution } = input
  return {
    projectPath: input.projectId,
    title: input.title,
    prompt: input.prompt,
    draft: input.draft ?? null,
    rule: input.rule,
    endsAt: input.endsAt,
    enabled: input.enabled,
    model: execution.modelId ?? null,
    accountId: accountIdForAgent(execution.instanceId ?? "") || null,
    permissionMode: sessionPermissionMode(execution.permissionMode, false),
    effort: effortForComposer(execution.effort ?? null),
    fast: execution.fast,
    worktree: execution.worktree,
  }
}

/** 立即运行在记录落盘后返回；已有同任务运行时使用上游的忙碌提示。 */
export function runNowView(run: ScheduledTaskRun): RunNowResult {
  if (run.status === "running") return { status: "started", runId: run.id }
  if (run.reason === "TASK_BUSY") return { status: "busy", runId: null }
  return { status: run.status === "skipped" ? "unavailable" : "failed", runId: null }
}

const reasonKeys = new Map<string, TextKey>([
  ["MEMBERSHIP_REQUIRED", "scheduledTasks.reasonMembership"],
  ["PROJECT_UNAVAILABLE", "scheduledTasks.reasonProject"],
  ["WORKSPACE_UNAVAILABLE", "scheduledTasks.reasonProject"],
  ["SCHEDULE_WORKTREE_FAILED", "scheduledTasks.reasonWorktree"],
  ["NO_AVAILABLE_ACCOUNT", "scheduledTasks.reasonAccount"],
  ["DAEMON_UNAVAILABLE", "scheduledTasks.reasonDaemon"],
  ["SESSION_LIMIT_REACHED", "scheduledTasks.reasonQueue"],
  ["CONCURRENCY_TIMEOUT", "scheduledTasks.reasonQueue"],
  ["TASK_BUSY", "scheduledTasks.reasonBusy"],
  ["MISSED", "scheduledTasks.reasonMissed"],
  ["APP_STOPPED", "scheduledTasks.reasonStopped"],
  ["SESSION_CANCELLED", "scheduledTasks.reasonCancelled"],
  ["SESSION_STOP_FAILED", "scheduledTasks.reasonParking"],
  ["EXECUTION_FAILED", "scheduledTasks.reasonFailed"],
  ["SDK_ERROR", "scheduledTasks.reasonFailed"],
])

/** 运行记录只显示已登记原因；异常原文和内部路径不进入设置页。 */
export function taskRunReason(reason: string): TextKey {
  return reasonKeys.get(reason) ?? "scheduledTasks.reasonUnknown"
}

const errorKeys = new Map<string, TextKey>([
  ["SCHEDULE_SERVICE_UNAVAILABLE", "scheduledTasks.unavailable"],
  ["SCHEDULE_SERVICE_CLOSED", "scheduledTasks.unavailable"],
  ["SCHEDULE_TASK_INVALID", "scheduledTasks.taskInvalid"],
  ["SCHEDULE_TASK_NOT_FOUND", "scheduledTasks.taskNotFound"],
  ["SCHEDULE_INTERVAL_TOO_SHORT", "scheduledTasks.minimumInterval"],
  ["SCHEDULE_RUN_ACTIVE", "scheduledTasks.runActive"],
  ["SCHEDULE_RUN_NOT_FOUND", "scheduledTasks.runMissing"],
])

/** 只翻译固定错误码，其他失败统一显示可重试提示。 */
export function taskErrorKey(error: unknown): TextKey {
  const code = error instanceof Error ? error.message.match(/\bSCHEDULE_[A-Z_]+\b/)?.[0] : undefined
  return (code && errorKeys.get(code)) || "scheduledTasks.operationFailed"
}

/** 运行时间与分页沿用 Pigcode 历史；用状态详情承载可读原因及账号。 */
export function taskHistoryPage(
  page: ScheduledTaskRunsPage,
  names: ReadonlyMap<string, string>,
  t: (key: TextKey) => string,
): { runs: ScheduleRun[]; total: number } {
  return {
    total: page.total,
    runs: page.runs.map((run) => historyRow(run, names, t)),
  }
}

function historyRow(
  run: ScheduledTaskRun,
  names: ReadonlyMap<string, string>,
  t: (key: TextKey) => string,
): ScheduleRun {
  const details = [
    run.reason === null ? null : t(taskRunReason(run.reason)),
    run.accountId === null
      ? null
      : fill(t("scheduledTasks.runAccount"), {
          account: names.get(run.accountId) ?? t("scheduledTasks.removedAccount"),
        }),
  ].filter((item) => item !== null)
  return {
    id: run.id,
    scheduleId: run.taskId,
    source: run.source,
    status: run.status,
    threadId: run.sessionId,
    runId: run.sessionId,
    error: details.length === 0 ? null : details.join(" · "),
    triggeredAt: run.triggeredAt,
    finishedAt: run.status === "skipped" ? null : run.finishedAt,
  }
}
