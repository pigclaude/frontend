// 让上游定时任务页接到 PigClaude 的本机调度、确认结果和唤醒设置。

const scheduleTypes = [
  [
    "AgentCommand, CommandParams, Thread, WorktreeStart",
    "AgentCommand, ScheduleExecution, SchedulePromptDraft, ScheduleRule, Thread, WorktreeStart",
  ],
  [
    'export type CreateScheduleInput = CommandParams<"schedule.create">\nexport type UpdateScheduleInput = Omit<CommandParams<"schedule.update">, "id">',
    `/** 新建任务提交给桌面调度的配置。 */
export type CreateScheduleInput = {
  projectId: string
  execution: ScheduleExecution
  title: string
  prompt: string
  draft?: SchedulePromptDraft
  rule: ScheduleRule
  endsAt: string | null
  enabled: boolean
}

/** 编辑任务只更新本次修改的字段。 */
export type UpdateScheduleInput = Partial<Omit<CreateScheduleInput, "projectId" | "draft">> & {
  draft?: SchedulePromptDraft | null
}`,
  ],
]

const schedulesPage = [
  ["  Info,\n", ""],
  ["Button, Menu, Spinner, Switch, toHostError", "Button, Menu, Spinner, toHostError"],
  ['import { usePreferences } from "./preferences"\n', ""],
  [
    'import { useEffect, useId, useState } from "react"',
    'import { useEffect, useId, useState, type ReactNode } from "react"',
  ],
  [
    "  historyRevision?: number | undefined\n",
    "  historyRevision?: number | undefined\n" +
      "  keepAwake?: ReactNode\n" +
      '  validateRule?: (rule: ScheduleDraft["rule"]) => string | null\n',
  ],
  [
    "  onDeleteRun: (runId: string) => Promise<unknown>",
    "  onDeleteRun: (taskId: string, runId: string) => Promise<unknown>",
  ],
  ["  historyRevision,\n", "  historyRevision,\n  keepAwake,\n  validateRule,\n"],
  [
    "        onDeleteRun={onDeleteRun}",
    "        onDeleteRun={(runId) => editing ? onDeleteRun(editing.id, runId) : Promise.resolve()}\n" +
      "        validateRule={validateRule}",
  ],
  ["{schedules.length > 0 ? <KeepAwakeBar /> : null}", "{schedules.length > 0 ? keepAwake : null}"],
  [
    "{schedules.length === 0 && !loading ? <KeepAwakeBar /> : null}",
    "{schedules.length === 0 && !loading ? keepAwake : null}",
  ],
]

const scheduleEditor = [
  ["  DEFAULT_RUNTIME_MODE,\n", ""],
  [
    'target?.kind === "project" ? target.execution : { permissionMode: DEFAULT_RUNTIME_MODE },',
    'target?.kind === "project" ? target.execution : { permissionMode: "approval-required" as const },',
  ],
  [
    "  historyRevision?: number | undefined\n",
    "  historyRevision?: number | undefined\n" +
      "  validateRule?: ((rule: ScheduleRule) => string | null) | undefined\n",
  ],
  ["  historyRevision = 0,\n", "  historyRevision = 0,\n  validateRule,\n"],
  [
    '  const canSave = !saving && ruleValid && (schedule ? dirty : projectId !== "")',
    "  const ruleError = validateRule?.(value.rule) ?? null\n" +
      '  const canSave = !saving && ruleValid && !ruleError && (schedule ? dirty : projectId !== "")',
  ],
  [
    "    try {\n      if (schedule) {",
    "    try {\n      let saved: unknown\n      if (schedule) {",
  ],
  [
    "        await onUpdate(schedule.id, patch)",
    "        saved = await onUpdate(schedule.id, patch)",
  ],
  ["        await onCreate({", "        saved = await onCreate({"],
  [
    "      onBack()\n    } catch (cause) {",
    "      if (saved === null) {\n        setSaving(false)\n        return\n      }\n" +
      "      onBack()\n    } catch (cause) {",
  ],
  [
    '          <div className="field">\n            <span className="label">{t("schedules.field.prompt")}</span>',
    '          {ruleError ? <p className="error-text" role="alert">{ruleError}</p> : null}\n' +
      '          <div className="field">\n            <span className="label">{t("schedules.field.prompt")}</span>',
  ],
]

const edits = {
  "src/schedule-types.ts": scheduleTypes,
  "src/schedules-page.tsx": schedulesPage,
  "src/schedule-editor.tsx": scheduleEditor,
}

/** 投影定时任务的桌面接口；上游锚点位置变化时停止同步。 */
export function projectSchedules(source, path) {
  if (path === "src/schedules-page.tsx") {
    const start = source.indexOf("/** 「保持电脑唤醒」")
    const end = source.indexOf("/** 渲染定时任务页。 */", start)
    if (start < 0 || end < 0) throw new Error("Pigcode 定时任务的唤醒组件位置已变动")
    source = source.slice(0, start) + source.slice(end)
  }
  for (const [before, after] of edits[path] ?? []) {
    const offset = source.indexOf(before)
    if (offset < 0 || source.indexOf(before, offset + before.length) >= 0)
      throw new Error(`Pigcode 定时任务适配源位置已变动：${path}`)
    source = source.replace(before, after)
  }
  return source
}
