// 将本机任务状态、日期和已登记原因解析成设置页可显示的数据。

import type { ScheduleRun } from "@pigclaude/ui-contracts"
import type {
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTaskRunsPage,
} from "../../../../scheduled-tasks-contract"
import { fill, type TextKey } from "../../locale/text"
import { projectNameFromPath } from "../../models/project-model"

/** 定时任务列表区分启用、暂停和规则已结束。 */
export type ScheduledTaskStatus = "active" | "paused" | "completed"

/** 根据实际排期区分已启用、有意暂停和不再有下一次触发。 */
export function taskStatus(task: ScheduledTask): ScheduledTaskStatus {
  if (!task.enabled) return "paused"
  return task.nextRunAt === null ? "completed" : "active"
}

/** 优先使用用户在工作区登记的显示名称，保留未知或已移除项目的目录名。 */
export function taskProjectName(path: string, names: Readonly<Record<string, string>>): string {
  return (Object.hasOwn(names, path) ? names[path] : undefined) || projectNameFromPath(path) || path
}

const reasonKeys = new Map<string, TextKey>([
  ["MEMBERSHIP_REQUIRED", "scheduledTasks.reasonMembership"],
  ["PROJECT_UNAVAILABLE", "scheduledTasks.reasonProject"],
  ["WORKSPACE_UNAVAILABLE", "scheduledTasks.reasonProject"],
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

/** ISO 结束时间显示为本机日历日期。 */
export function taskDateInput(endsAt: string | null): string {
  if (endsAt === null) return ""
  const date = new Date(endsAt)
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

/** 选定日期包含当天，保存为本机午夜前一毫秒。 */
export function taskEndOfDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(value + "T23:59:59.999")
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
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
    threadId: run.sessionId ?? "",
    runId: run.sessionId,
    error: details.length === 0 ? null : details.join(" · "),
    triggeredAt: run.triggeredAt,
    finishedAt: run.status === "skipped" ? null : run.finishedAt,
  }
}
