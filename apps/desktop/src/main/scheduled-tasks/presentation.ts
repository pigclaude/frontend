// 把已保存的定时任务状态交给托盘与通知，只使用项目名称、时间和经过限定的结果类别。

import { basename } from "node:path"
import type { ScheduledTaskRun } from "../../scheduled-tasks-contract"
import type {
  BackgroundNotice,
  NotificationSession,
} from "../notifications/background-notification"
import type { ScheduledTaskService } from "./service"

const noticeKinds = {
  succeeded: "scheduled-completed",
  failed: "scheduled-failed",
  skipped: "scheduled-skipped",
} as const

/** 订阅定时任务展示的依赖。只有后台受理通知时才消耗一次原因提醒。 */
export type ScheduledTaskPresentationOptions = {
  service: Pick<ScheduledTaskService, "subscribe" | "list">
  refreshTray: () => void
  announce: (notice: BackgroundNotice, session?: NotificationSession | null) => boolean
}

/** 刷新托盘并补足没有会话终态事件的运行通知。同类失败或跳过原因在本次应用运行中只提醒一次。 */
export function observeScheduledTaskPresentation({
  service,
  refreshTray,
  announce,
}: ScheduledTaskPresentationOptions): () => void {
  let active = true
  const announcedReasons = new Set<string>()
  const unsubscribe = service.subscribe((change) => {
    if (!active) return
    if (change.type === "tasks") refreshTray()
    else void notifyRun(change.run).catch(() => undefined)
  })
  return () => {
    active = false
    announcedReasons.clear()
    unsubscribe()
  }

  async function notifyRun(run: ScheduledTaskRun): Promise<void> {
    if (run.status === "running" || run.status === "stopped" || run.sessionNoticeHandled) return
    const reason = notificationReason(run)
    if (reason !== null && announcedReasons.has(reason)) return
    const tasks = await service.list().catch(() => [])
    if (!active || (reason !== null && announcedReasons.has(reason))) return
    const task = tasks.find(({ id }) => id === run.taskId)
    const context = task
      ? { projectPath: task.projectPath, title: "", titleSource: "auto" as const }
      : null
    if (
      announce({ kind: noticeKinds[run.status], sessionId: run.sessionId }, context) &&
      reason !== null
    )
      announcedReasons.add(reason)
  }
}

function notificationReason(run: ScheduledTaskRun): string | null {
  if (run.status === "succeeded") return null
  return run.reason && /^[A-Z][A-Z0-9_]{0,63}$/.test(run.reason) ? run.reason : run.status
}

/** 只显示可读的项目目录名。供原生托盘菜单和退出确认共用。 */
export function scheduledProjectName(projectPath: string): string {
  const name = basename(projectPath)
    .replace(/[\p{Cc}\p{Cf}\s]+/gu, " ")
    .trim()
  return Array.from(name).slice(0, 64).join("") || "项目"
}

/** 每次显示时按当前本机时区格式化排期与最近一次运行。 */
export function scheduledLocalTime(instant: string): string {
  return new Date(instant).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })
}
