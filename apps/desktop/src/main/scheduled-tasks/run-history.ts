// 维护每个定时任务的运行认领、终态和最近记录。

import { randomUUID } from "node:crypto"
import type { ScheduledTaskOutcome, ScheduledTaskRun } from "../../scheduled-tasks-contract"
import { maximumScheduledTaskRuns, newestScheduledRunFirst, type SavedScheduledTask } from "./store"

/** 在任务快照中认领本次触发，忙碌或过期时记录跳过。 */
export function claimRun(
  saved: SavedScheduledTask,
  scheduledAt: string | null,
  missed: boolean,
  now: number,
): ScheduledTaskRun {
  const reason = missed ? "MISSED" : saved.active === null ? null : "TASK_BUSY"
  const at = new Date(now).toISOString()
  const triggerSequence = saved.task.runCount + 1
  const run: ScheduledTaskRun = {
    id: randomUUID(),
    taskId: saved.task.id,
    triggerSequence,
    source: scheduledAt === null ? "manual" : "schedule",
    status: reason === null ? "running" : "skipped",
    scheduledAt,
    triggeredAt: at,
    finishedAt: reason === null ? null : at,
    reason,
    sessionId: null,
    accountId: null,
    deniedApprovals: 0,
  }
  saved.task.lastRunAt = at
  saved.task.runCount = triggerSequence
  if (run.status === "running") saved.active = run
  else saved.history.unshift(run)
  trimHistory(saved)
  return run
}

/** 把已处理的结果合并到原记录，完成时间不会早于认领时间。 */
export function completedRun(
  run: ScheduledTaskRun,
  outcome: ScheduledTaskOutcome,
  now: number,
): ScheduledTaskRun {
  return {
    ...run,
    status: outcome.status,
    reason: outcome.reason ?? null,
    sessionId: outcome.sessionId ?? null,
    accountId: outcome.accountId ?? null,
    deniedApprovals: outcome.deniedApprovals ?? 0,
    ...(outcome.sessionNoticeHandled === true ? { sessionNoticeHandled: true } : {}),
    finishedAt: new Date(Math.max(now, Date.parse(run.triggeredAt))).toISOString(),
  }
}

/** 结束当前认领，并保留最近触发的运行记录。 */
export function finishRun(saved: SavedScheduledTask, run: ScheduledTaskRun): void {
  saved.active = null
  if (run.sessionId !== null) saved.task.lastSessionId = run.sessionId
  saved.history.unshift(run)
  saved.history.sort(newestScheduledRunFirst)
  trimHistory(saved)
}

function trimHistory(saved: SavedScheduledTask): void {
  saved.history = saved.history.slice(0, maximumScheduledTaskRuns - (saved.active === null ? 0 : 1))
}
