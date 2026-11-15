// 负责新建和编辑任务表单，复用 Pigcode 计划编辑器并将结束日期保存成本机日历时间。

import { useMemo, useState, type FormEvent } from "react"
import { Button, Input, Switch, Textarea } from "@pigclaude/ui-primitives"
import { DEFAULT_RULE, ScheduleRuleField, type RuleValue } from "@pigclaude/ui-settings"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { ScheduledTask, ScheduledTaskInput } from "../../../../scheduled-tasks-contract"
import type { ClaudeModel } from "../../../../main/session/session-types"
import { useText, type TextKey } from "../../locale/text"
import { SettingPage } from "./setting-page"
import { taskDateInput, taskEndOfDay, taskProjectName } from "./scheduled-task-view"

const permissions = [
  ["default", "scheduledTasks.permissionDefault"],
  ["acceptEdits", "scheduledTasks.permissionEdits"],
  ["auto", "scheduledTasks.permissionAuto"],
  ["bypassPermissions", "scheduledTasks.permissionFull"],
] as const

/** 展示定时任务所有本机配置。保存失败或取消原生确认时保留草稿。 */
export function ScheduledTaskEditor({
  task,
  projectPaths,
  projectNames,
  currentProject,
  accounts,
  models,
  modelsLoading,
  busy,
  error,
  onSave,
  onBack,
}: {
  task: ScheduledTask | null
  projectPaths: readonly string[]
  projectNames: Readonly<Record<string, string>>
  currentProject: string | null
  accounts: readonly ClaudeAccountView[]
  models: readonly ClaudeModel[]
  modelsLoading: boolean
  busy: boolean
  error: TextKey | null
  onSave: (input: ScheduledTaskInput) => void
  onBack: () => void
}) {
  const { t } = useText()
  const [draft, setDraft] = useState<ScheduledTaskInput>(() => ({
    projectPath:
      task?.projectPath ??
      (currentProject !== null && projectPaths.includes(currentProject)
        ? currentProject
        : (projectPaths[0] ?? "")),
    prompt: task?.prompt ?? "",
    rule: task?.rule ?? DEFAULT_RULE,
    endsAt: task?.endsAt ?? null,
    enabled: task?.enabled ?? true,
    model: task?.model ?? null,
    permissionMode: task?.permissionMode ?? "default",
    accountId: task?.accountId ?? null,
  }))
  const ruleValue = useMemo(
    () => ({ rule: draft.rule, endsAt: draft.endsAt }),
    [draft.rule, draft.endsAt],
  )
  const [ruleValid, setRuleValid] = useState(true)
  const custom = draft.rule.kind.startsWith("every")
  const shortInterval = draft.rule.kind === "everyMinutes" && draft.rule.every < 15
  const valid =
    draft.projectPath !== "" && draft.prompt.trim() !== "" && ruleValid && !shortInterval
  const availableProjects =
    draft.projectPath && !projectPaths.includes(draft.projectPath)
      ? [draft.projectPath, ...projectPaths]
      : projectPaths

  function change(fields: Partial<ScheduledTaskInput>): void {
    setDraft((before) => ({ ...before, ...fields }))
  }

  function changeRule(next: RuleValue | null): void {
    setRuleValid(next !== null)
    if (next !== null) {
      change({
        rule: next.rule,
        endsAt: next.rule.kind.startsWith("every") ? next.endsAt : draft.endsAt,
      })
    }
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (valid && !busy) onSave(draft)
  }

  return (
    <SettingPage
      title={t(task === null ? "scheduledTasks.create" : "scheduledTasks.edit")}
      sub={t("scheduledTasks.localTime")}
      actions={
        <>
          <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
            {t("scheduledTasks.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            form="scheduled-task-form"
            disabled={!valid || busy}
          >
            {t("scheduledTasks.save")}
          </Button>
        </>
      }
    >
      <form id="scheduled-task-form" className="scheduled-task-editor" onSubmit={save}>
        {error ? (
          <p className="error-text" role="alert">
            {t(error)}
          </p>
        ) : null}
        <label className="field">
          <span className="label">{t("scheduledTasks.project")}</span>
          <select
            className="input"
            value={draft.projectPath}
            disabled={busy}
            onChange={(event) => change({ projectPath: event.currentTarget.value })}
          >
            <option value="">{t("scheduledTasks.chooseProject")}</option>
            {availableProjects.map((path) => (
              <option key={path} value={path}>
                {taskProjectName(path, projectNames)} · {path}
              </option>
            ))}
          </select>
        </label>
        {availableProjects.length === 0 ? (
          <p className="hint">{t("scheduledTasks.noProjects")}</p>
        ) : null}
        <label className="field">
          <span className="label">{t("scheduledTasks.prompt")}</span>
          <Textarea
            rows={5}
            value={draft.prompt}
            disabled={busy}
            placeholder={t("scheduledTasks.promptPlaceholder")}
            onChange={(event) => change({ prompt: event.currentTarget.value })}
          />
        </label>
        <div className="field">
          <span className="label">{t("scheduledTasks.rule")}</span>
          <ScheduleRuleField value={ruleValue} disabled={busy} onChange={changeRule} />
          {shortInterval ? (
            <p role="alert" className="error-text">
              {t("scheduledTasks.minimumInterval")}
            </p>
          ) : null}
        </div>
        {!custom ? (
          <label className="field">
            <span className="label">{t("scheduledTasks.endDate")}</span>
            <Input
              type="date"
              value={taskDateInput(draft.endsAt)}
              disabled={busy}
              onChange={(event) => change({ endsAt: taskEndOfDay(event.currentTarget.value) })}
            />
          </label>
        ) : null}
        <div className="scheduled-task-fields">
          <label className="field">
            <span className="label">{t("scheduledTasks.model")}</span>
            <select
              className="input"
              value={draft.model ?? ""}
              disabled={busy}
              onChange={(event) => change({ model: event.currentTarget.value || null })}
            >
              <option value="">{t("scheduledTasks.defaultModel")}</option>
              {draft.model && !models.some(({ id }) => id === draft.model) ? (
                <option value={draft.model}>{draft.model}</option>
              ) : null}
              {models.map(({ id, displayName }) => (
                <option key={id} value={id}>
                  {displayName}
                </option>
              ))}
            </select>
            {modelsLoading ? (
              <span className="hint">{t("scheduledTasks.loadingModels")}</span>
            ) : null}
          </label>
          <label className="field">
            <span className="label">{t("scheduledTasks.account")}</span>
            <select
              className="input"
              value={draft.accountId ?? ""}
              disabled={busy}
              onChange={(event) => change({ accountId: event.currentTarget.value || null })}
            >
              <option value="">{t("scheduledTasks.autoAccount")}</option>
              {draft.accountId && !accounts.some(({ id }) => id === draft.accountId) ? (
                <option value={draft.accountId}>{t("scheduledTasks.removedAccount")}</option>
              ) : null}
              {accounts.map(({ id, displayName }) => (
                <option key={id} value={id}>
                  {displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">{t("scheduledTasks.permissionMode")}</span>
            <select
              className="input"
              value={draft.permissionMode}
              disabled={busy}
              onChange={(event) => {
                const mode = permissions.find(([id]) => id === event.currentTarget.value)?.[0]
                if (mode) change({ permissionMode: mode })
              }}
            >
              {permissions.map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {draft.permissionMode === "bypassPermissions" ? (
          <p className="hint">{t("scheduledTasks.fullAccessHint")}</p>
        ) : null}
        <label className="scheduled-task-switch">
          <span className="label">{t("scheduledTasks.enabled")}</span>
          <Switch
            aria-label={t("scheduledTasks.enabled")}
            checked={draft.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => change({ enabled })}
          />
        </label>
      </form>
    </SettingPage>
  )
}
