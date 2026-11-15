// 列出本机任务、按状态筛选，并把任务操作交给设置页控制器。

import { useState } from "react"
import { Button, formatDateTime, useLocale } from "@pigclaude/ui-primitives"
import { formatRule } from "@pigclaude/ui-settings"
import type { ScheduledTask } from "../../../../scheduled-tasks-contract"
import { fill, useText } from "../../locale/text"
import { taskProjectName, taskStatus } from "./scheduled-task-view"

const filters = ["all", "active", "paused", "completed"] as const

/** 任务列表的操作只携带选中的任务；保存、运行和删除由主进程负责。 */
export type ScheduledTaskListProps = {
  tasks: readonly ScheduledTask[]
  projectNames: Readonly<Record<string, string>>
  busy: boolean
  onEdit: (task: ScheduledTask) => void
  onHistory: (task: ScheduledTask) => void
  onToggle: (task: ScheduledTask) => void
  onRun: (task: ScheduledTask) => void
  onRemove: (task: ScheduledTask) => void
}

/** 显示筛选后的任务和已保存的下一次触发。 */
export function ScheduledTaskList({ tasks, ...actions }: ScheduledTaskListProps) {
  const { t } = useText()
  const [filter, setFilter] = useState<(typeof filters)[number]>("all")
  if (tasks.length === 0)
    return (
      <div className="schedules-empty">
        <p className="schedules-empty-title">{t("scheduledTasks.empty")}</p>
      </div>
    )
  const visible = tasks.filter((task) => filter === "all" || taskStatus(task) === filter)
  return (
    <>
      <div className="schedules-filter" role="group" aria-label={t("scheduledTasks.filter")}>
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            className="schedules-filter-pill"
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {t(`scheduledTasks.${item}`)}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="schedules-filter-empty">{t("scheduledTasks.noMatches")}</p>
      ) : (
        <div className="schedules-stack">
          <div className="schedules-grid">
            {visible.map((task) => (
              <ScheduledTaskCard key={task.id} task={task} {...actions} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function ScheduledTaskCard({
  task,
  projectNames,
  busy,
  onEdit,
  onHistory,
  onToggle,
  onRun,
  onRemove,
}: Omit<ScheduledTaskListProps, "tasks"> & { task: ScheduledTask }) {
  const { t } = useText()
  const { locale, t: scheduleText } = useLocale()
  const state = taskStatus(task)
  return (
    <article className="schedule-card" data-status={state}>
      <h2 className="schedule-card-title" title={task.projectPath}>
        {taskProjectName(task.projectPath, projectNames)}
      </h2>
      <p className="schedule-card-prompt">{task.prompt}</p>
      <p className="hint">{formatRule(task.rule, scheduleText, locale)}</p>
      <div className="schedule-card-foot">
        <span className="schedule-card-state">{t(`scheduledTasks.${state}`)}</span>
        <span className="schedule-card-count">
          {fill(t("scheduledTasks.runCount"), { count: task.runCount })}
        </span>
      </div>
      {task.nextRunAt !== null ? (
        <span className="schedule-card-when">
          {fill(t("scheduledTasks.nextRun"), {
            time: formatDateTime(task.nextRunAt, locale),
          })}
        </span>
      ) : null}
      <div className="scheduled-task-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onEdit(task)}
        >
          {t("scheduledTasks.edit")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onHistory(task)}>
          {t("scheduledTasks.history")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onRun(task)}>
          {t("scheduledTasks.runNow")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onToggle(task)}
        >
          {t(task.enabled ? "scheduledTasks.pause" : "scheduledTasks.resume")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onRemove(task)}
        >
          {t("scheduledTasks.delete")}
        </Button>
      </div>
    </article>
  )
}
