// 将主界面的上游定时任务页面接到本机调度服务与当前项目、账号。

import { useEffect, useMemo, useState } from "react"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import { EmptyState, useLocale } from "@pigclaude/ui-primitives"
import {
  SchedulesPage,
  type ScheduleComposerSources,
  type UpdateScheduleInput,
} from "@pigclaude/ui-settings"
import { PageErrorBoundary, ScrollPanel } from "@pigclaude/ui-shell"
import {
  minimumScheduledTaskMinutes,
  type ScheduledTask,
  type ScheduledTasksBridge,
} from "../../../scheduled-tasks-contract"
import type { SessionController } from "../hooks/use-session"
import { useText, type TextKey } from "../locale/text"
import { AUTO_ACCOUNT, composerAgents, composerCatalog } from "../models/composer-config"
import {
  nativeScheduleInput,
  runNowView,
  scheduleView,
  taskErrorKey,
  taskHistoryPage,
} from "../models/scheduled-task-view"
import { workspaceProjects } from "../shell/workspace-threads"
import { ScheduleWorkspaceControls } from "./schedule-workspace-controls"
import { KeepAwakeSetting } from "./settings/keep-awake-setting"

type Props = {
  projectPaths: readonly string[]
  projectNames: Readonly<Record<string, string>>
  currentProject: string | null
  accounts: readonly ClaudeAccountView[]
  session: Pick<SessionController, "models" | "modelsError" | "refreshModels">
  onAddProject: () => void
  onOpenThread: (id: string) => void
}

/** 独立定时任务页面，使用同一个主窗口工作区和会话控制器。 */
export function ScheduledTasksScreen(props: Props) {
  const { t } = useText()
  const { t: uiText } = useLocale()
  const bridge = window.pigclaude?.scheduledTasks
  const unavailable = t("scheduledTasks.unavailable")
  return (
    <PageErrorBoundary fallback={() => <EmptyState title={unavailable} />}>
      <ScrollPanel>
        {bridge ? (
          <ScheduledTasksContent bridge={bridge} {...props} />
        ) : (
          <div className="page wide schedules">
            <header className="page-head">
              <h1>{uiText("settings.schedules.pageTitle")}</h1>
            </header>
            <p className="error-text" role="alert">
              {unavailable}
            </p>
          </div>
        )}
      </ScrollPanel>
    </PageErrorBoundary>
  )
}

function ScheduledTasksContent({
  bridge,
  projectPaths,
  projectNames,
  currentProject,
  accounts,
  session,
  onAddProject,
  onOpenThread,
}: Props & { bridge: ScheduledTasksBridge }) {
  const { t } = useText()
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null)
  const [error, setError] = useState<TextKey | null>(null)
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((value) => value + 1)
  useEffect(() => bridge.subscribe(() => setRevision((value) => value + 1)), [bridge])
  useEffect(() => {
    let live = true
    void bridge.list().then(
      (value) => {
        if (live) {
          setTasks(value)
          setError(null)
        }
      },
      (cause: unknown) => {
        if (live) setError(taskErrorKey(cause))
      },
    )
    return () => {
      live = false
    }
  }, [bridge, revision])

  const projects = workspaceProjects(projectPaths, projectNames)
  const schedules = (tasks ?? []).map(scheduleView)
  const accountNames = new Map(accounts.map(({ id, displayName }) => [id, displayName]))
  const agents = composerAgents(accounts).map((agent) => ({
    ...agent,
    executionModes: { plan: false },
  }))
  const models = session.models.length > 0 || session.modelsError !== null ? session.models : null
  const native = window.pigclaude
  const sources = useMemo<ScheduleComposerSources>(
    () => ({
      listFiles: (projectId) => native?.workspaces?.files(projectId) ?? Promise.resolve([]),
      loadCommands: async (_instanceId, scope) =>
        scope && "projectId" in scope
          ? [...((await native?.session?.commands?.({ workspace: scope.projectId })) ?? [])]
          : [],
      ...(native?.workbench
        ? { workspaceControls: (props) => <ScheduleWorkspaceControls {...props} /> }
        : {}),
    }),
    [native],
  )

  async function mutate<T>(action: () => Promise<T>): Promise<T> {
    try {
      const result = await action()
      refresh()
      return result
    } catch (cause) {
      throw new Error(t(taskErrorKey(cause)))
    }
  }

  async function update(id: string, patch: UpdateScheduleInput) {
    return mutate(async () => {
      if (Object.keys(patch).length === 1 && patch.enabled !== undefined)
        return bridge.setEnabled(id, patch.enabled)
      const current = (await bridge.list()).find((task) => task.id === id)
      if (!current) throw new Error("SCHEDULE_TASK_NOT_FOUND")
      const value = scheduleView(current)
      if (value.target.kind !== "project") throw new Error("SCHEDULE_TASK_INVALID")
      return bridge.update(
        id,
        nativeScheduleInput({
          ...value,
          execution: value.target.execution,
          projectId: current.projectPath,
          ...patch,
        }),
      )
    })
  }

  return (
    <SchedulesPage
      schedules={schedules}
      threads={[]}
      projects={projects}
      preferredProjectId={currentProject}
      agentOptions={{
        agents,
        catalog: composerCatalog(agents, models),
        defaultInstanceId: AUTO_ACCOUNT,
        onLoadModels: () => {
          void session.refreshModels()
        },
      }}
      composerSources={sources}
      keepAwake={<KeepAwakeSetting inSchedules />}
      validateRule={(rule) =>
        rule.kind === "everyMinutes" && rule.every < minimumScheduledTaskMinutes
          ? t("scheduledTasks.minimumInterval")
          : null
      }
      loading={tasks === null && !error}
      error={error ? t(error) : null}
      historyRevision={revision}
      onAddProject={onAddProject}
      onRefresh={refresh}
      onCreate={(input) => mutate(() => bridge.create(nativeScheduleInput(input)))}
      onUpdate={update}
      onDelete={(id) => mutate(() => bridge.remove(id))}
      onRunNow={(id) => mutate(async () => runNowView(await bridge.runNow(id)))}
      onLoadRuns={(id, offset, limit) =>
        bridge.runs(id, offset, limit).then(
          (page) => taskHistoryPage(page, accountNames, t),
          (cause: unknown) => {
            throw new Error(t(taskErrorKey(cause)))
          },
        )
      }
      onDeleteRun={(taskId, runId) => mutate(() => bridge.removeRun(taskId, runId))}
      onOpenThread={onOpenThread}
    />
  )
}
