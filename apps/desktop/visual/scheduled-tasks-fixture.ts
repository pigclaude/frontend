// 为定时任务截图提供本机任务和运行记录的合成数据。

import type { Page } from "@playwright/test"
import type { ScheduledTask, ScheduledTaskRun } from "../src/scheduled-tasks-contract"

const projects = ["/work/pigclaude", "/work/release"]
const scheduled: ScheduledTask = {
  id: "check-build",
  projectPath: "/work/pigclaude",
  prompt: "检查主分支的构建和测试结果，汇总失败的步骤。",
  rule: { kind: "daily", time: "09:00" },
  endsAt: null,
  enabled: true,
  model: null,
  permissionMode: "default",
  accountId: null,
  nextRunAt: "2026-11-16T01:00:00.000Z",
  lastRunAt: "2026-11-15T01:00:00.000Z",
  lastSessionId: "visual-session",
  runCount: 2,
}
const paused: ScheduledTask = {
  ...scheduled,
  id: "summarize-release",
  projectPath: "/work/release",
  prompt: "汇总这周的版本变更，列出待确认的发布事项。",
  rule: { kind: "weekly", days: [1, 5], time: "16:30" },
  enabled: false,
  nextRunAt: null,
  lastRunAt: null,
  lastSessionId: null,
  runCount: 0,
}
const run: ScheduledTaskRun = {
  id: "build-success",
  taskId: scheduled.id,
  triggerSequence: 2,
  source: "schedule",
  status: "succeeded",
  scheduledAt: "2026-11-15T01:00:00.000Z",
  triggeredAt: "2026-11-15T01:00:00.000Z",
  finishedAt: "2026-11-15T01:03:00.000Z",
  reason: null,
  sessionId: "visual-session",
  accountId: "preview-work",
  deniedApprovals: 0,
}
const skipped: ScheduledTaskRun = {
  ...run,
  id: "build-skipped",
  triggerSequence: 1,
  status: "skipped",
  scheduledAt: "2026-11-14T01:00:00.000Z",
  triggeredAt: "2026-11-14T01:00:00.000Z",
  finishedAt: "2026-11-14T01:00:00.000Z",
  reason: "PROJECT_UNAVAILABLE",
  accountId: null,
  sessionId: null,
}

/** 在预览页面加载前注入独立的任务、项目及运行记录。 */
export async function installScheduledTasksPreview(page: Page): Promise<void> {
  await page.addInitScript(
    ({ projects, tasks, runs }) => {
      const unavailable = async () => {
        throw new Error("SCHEDULE_SERVICE_UNAVAILABLE")
      }
      window.pigclaude = {
        platform: "darwin",
        workspaces: {
          list: async () => projects,
          add: unavailable,
          remove: unavailable,
          rename: unavailable,
          files: async () => [],
          names: async () => ({ "/work/pigclaude": "PigClaude", "/work/release": "发布项目" }),
          reveal: unavailable,
          apps: async () => [],
          openWith: unavailable,
        },
        scheduledTasks: {
          list: async () => tasks,
          create: unavailable,
          update: unavailable,
          setEnabled: unavailable,
          remove: unavailable,
          runNow: unavailable,
          runs: async (id, offset, limit) => {
            const entries = runs.filter((entry) => entry.taskId === id)
            return { runs: entries.slice(offset, offset + limit), total: entries.length }
          },
          removeRun: unavailable,
          subscribe: () => () => undefined,
        },
      }
    },
    { projects, tasks: [scheduled, paused], runs: [run, skipped] },
  )
}
