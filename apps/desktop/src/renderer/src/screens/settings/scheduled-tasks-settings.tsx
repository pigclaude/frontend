// 连接本机调度桥与设置页，读取已落盘任务并导航到编辑、运行历史或会话。

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@pigclaude/ui-primitives"
import { ScheduleHistory } from "@pigclaude/ui-settings"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTasksBridge,
} from "../../../../scheduled-tasks-contract"
import type { ClaudeModel } from "../../../../main/session/session-types"
import { useText, type TextKey } from "../../locale/text"
import { SettingPage } from "./setting-page"
import { ScheduledTaskEditor } from "./scheduled-task-editor"
import { ScheduledTaskList } from "./scheduled-task-list"
import {
  taskErrorKey,
  taskHistoryPage,
  taskProjectName,
  taskRunReason,
} from "./scheduled-task-view"
import "../../styles/scheduled-tasks.css"

type View =
  | { kind: "list" }
  | { kind: "edit"; task: ScheduledTask | null }
  | { kind: "history"; task: ScheduledTask }

/** 定时任务设置页。界面命令都经受信桥交给本机调度服务。 */
export function ScheduledTasksSettings({
  bridge,
  projectPaths,
  projectNames,
  currentProject,
  accounts,
  models,
  modelsLoading,
  loadModels,
  openSession,
}: {
  bridge: ScheduledTasksBridge | undefined
  projectPaths: readonly string[]
  projectNames: Readonly<Record<string, string>>
  currentProject: string | null
  accounts: readonly ClaudeAccountView[]
  models: readonly ClaudeModel[]
  modelsLoading: boolean
  loadModels: () => Promise<void>
  openSession: (id: string, projectPath: string) => void
}) {
  const { t } = useText()
  const [view, setView] = useState<View>({ kind: "list" })
  const [tasks, setTasks] = useState<readonly ScheduledTask[] | null>(null)
  const [revision, refresh] = useState(0)
  const [loadError, setLoadError] = useState<TextKey | null>(null)
  const [error, setError] = useState<TextKey | null>(null)
  const [status, setStatus] = useState<TextKey | null>(null)
  const [busy, setBusy] = useState(false)
  const accountNames = useMemo(
    () => new Map(accounts.map(({ id, displayName }) => [id, displayName])),
    [accounts],
  )

  useEffect(() => bridge?.subscribe(() => refresh((value) => value + 1)), [bridge])
  useEffect(() => {
    if (!bridge) return
    let current = true
    void bridge.list().then(
      (result) => {
        if (!current) return
        setTasks(result)
        setLoadError(null)
      },
      (cause: unknown) => {
        if (current) setLoadError(taskErrorKey(cause))
      },
    )
    return () => {
      current = false
    }
  }, [bridge, revision])

  function show(next: View): void {
    setError(null)
    setStatus(null)
    setView(next)
  }

  function edit(task: ScheduledTask | null): void {
    show({ kind: "edit", task })
    void loadModels().catch(() => undefined)
  }

  async function mutate(
    action: (service: ScheduledTasksBridge) => Promise<unknown>,
  ): Promise<void> {
    if (busy || !bridge) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await action(bridge)
      refresh((value) => value + 1)
    } catch (cause: unknown) {
      setError(taskErrorKey(cause))
    } finally {
      setBusy(false)
    }
  }

  function save(task: ScheduledTask | null, input: ScheduledTaskInput): void {
    void mutate(async (service) => {
      const saved = await (task === null ? service.create(input) : service.update(task.id, input))
      if (saved !== null) show({ kind: "list" })
    })
  }

  const back = () => show({ kind: "list" })
  const errorNotice = error ? (
    <p className="error-text schedules-error" role="alert">
      {t(error)}
    </p>
  ) : null
  if (view.kind === "edit") {
    return (
      <ScheduledTaskEditor
        key={view.task?.id ?? "new"}
        task={view.task}
        projectPaths={projectPaths}
        projectNames={projectNames}
        currentProject={currentProject}
        accounts={accounts}
        models={models}
        modelsLoading={modelsLoading}
        busy={busy}
        error={error}
        onSave={(input) => save(view.task, input)}
        onBack={back}
      />
    )
  }
  if (view.kind === "history" && bridge) {
    return (
      <ScheduledHistoryPage
        key={view.task.id}
        bridge={bridge}
        task={view.task}
        projectNames={projectNames}
        accountNames={accountNames}
        revision={revision}
        openSession={openSession}
        onBack={back}
      />
    )
  }
  return (
    <SettingPage
      title={t("scheduledTasks.title")}
      sub={t("scheduledTasks.localTime")}
      width="wide"
      actions={
        bridge ? (
          <Button type="button" variant="primary" disabled={busy} onClick={() => edit(null)}>
            {t("scheduledTasks.create")}
          </Button>
        ) : undefined
      }
    >
      {errorNotice}
      {status ? <p role="status">{t(status)}</p> : null}
      {!bridge || loadError ? (
        <p role="alert" className="error-text">
          {t(loadError ?? "scheduledTasks.unavailable")}
        </p>
      ) : null}
      {bridge && tasks === null && !loadError ? (
        <p role="status" className="hint">
          {t("scheduledTasks.loading")}
        </p>
      ) : null}
      {tasks !== null ? (
        <ScheduledTaskList
          tasks={tasks}
          projectNames={projectNames}
          busy={busy}
          onEdit={edit}
          onHistory={(task) => show({ kind: "history", task })}
          onToggle={(task) => void mutate((service) => service.setEnabled(task.id, !task.enabled))}
          onRun={(task) => {
            void mutate(async (service) => {
              const run = await service.runNow(task.id)
              setStatus(
                run.reason === null ? "scheduledTasks.runRequested" : taskRunReason(run.reason),
              )
            })
          }}
          onRemove={(task) => {
            if (window.confirm(t("scheduledTasks.deleteConfirm")))
              void mutate((service) => service.remove(task.id))
          }}
        />
      ) : null}
    </SettingPage>
  )
}

function ScheduledHistoryPage({
  bridge,
  task,
  projectNames,
  accountNames,
  revision,
  openSession,
  onBack,
}: {
  bridge: ScheduledTasksBridge
  task: ScheduledTask
  projectNames: Readonly<Record<string, string>>
  accountNames: ReadonlyMap<string, string>
  revision: number
  openSession: (id: string, projectPath: string) => void
  onBack: () => void
}) {
  const { t } = useText()
  const [error, setError] = useState<TextKey | null>(null)
  // Pigcode 在分页请求改变时重读，用任务事件刷新当前页而不重置页码。
  const loadRuns = useMemo(() => {
    return async (id: string, offset: number, limit: number) => {
      try {
        return taskHistoryPage(await bridge.runs(id, offset, limit), accountNames, t)
      } catch (cause: unknown) {
        throw new Error(t(taskErrorKey(cause)))
      }
    }
  }, [bridge, accountNames, revision, t])
  const remove = useCallback(
    async (runId: string) => {
      setError(null)
      try {
        await bridge.removeRun(task.id, runId)
      } catch (cause: unknown) {
        setError(taskErrorKey(cause))
      }
    },
    [bridge, task.id],
  )
  return (
    <SettingPage
      title={t("scheduledTasks.history")}
      sub={taskProjectName(task.projectPath, projectNames)}
      width="wide"
      actions={
        <Button type="button" variant="ghost" onClick={onBack}>
          {t("scheduledTasks.back")}
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="error-text">
          {t(error)}
        </p>
      ) : null}
      <div className="scheduled-task-history">
        <ScheduleHistory
          scheduleId={task.id}
          onLoadRuns={loadRuns}
          onDeleteRun={remove}
          onOpenThread={(id) => openSession(id, task.projectPath)}
        />
      </div>
    </SettingPage>
  )
}
