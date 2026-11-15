// 用合成运行事件验证定时任务通知的归属、后台门槛和隐私边界。

import { resolve } from "node:path"
import { expect, it, vi } from "vitest"
import type {
  ScheduledTask,
  ScheduledTaskChange,
  ScheduledTaskRun,
} from "../../scheduled-tasks-contract"
import { createBackgroundNotifications } from "../notifications/background-notifications"
import type { SystemNotificationContent } from "../notifications/background-notification"
import { observeScheduledTaskPresentation } from "./presentation"

const task: ScheduledTask = {
  id: "task-a",
  projectPath: resolve("private-parent", "Report"),
  prompt: "private-scheduled-prompt",
  enabled: false,
  rule: { kind: "daily", time: "09:00" },
  endsAt: null,
  model: null,
  accountId: null,
  permissionMode: "default",
  nextRunAt: null,
  lastRunAt: null,
  lastSessionId: null,
  runCount: 0,
}

function run(overrides: Partial<ScheduledTaskRun> = {}): ScheduledTaskRun {
  return {
    id: "run-a",
    taskId: task.id,
    triggerSequence: 1,
    source: "schedule",
    status: "failed",
    scheduledAt: "2026-11-15T09:00:00.000Z",
    triggeredAt: "2026-11-15T09:00:00.000Z",
    finishedAt: "2026-11-15T09:00:00.000Z",
    reason: "EXECUTION_FAILED",
    sessionId: null,
    accountId: null,
    deniedApprovals: 0,
    ...overrides,
  }
}

function fixture() {
  let foreground = false
  let listener: ((change: ScheduledTaskChange) => void) | undefined
  const openWindow = vi.fn()
  const openSession = vi.fn()
  const refreshTray = vi.fn()
  const shown: Array<SystemNotificationContent & { click: () => void }> = []
  const controller = createBackgroundNotifications({
    platform: "darwin",
    window: () => ({
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      isFocused: () => foreground,
    }),
    show: (content, { click }) => shown.push({ ...content, click }),
    openWindow,
    openSession,
    trayBadge: vi.fn(),
  })
  const dispose = observeScheduledTaskPresentation({
    service: {
      list: async () => [task],
      subscribe: (next) => {
        listener = next
        return () => (listener = undefined)
      },
    },
    refreshTray,
    announce: controller.announce,
  })
  async function publish(change: ScheduledTaskChange): Promise<void> {
    listener?.(change)
    await Promise.resolve()
    await Promise.resolve()
  }
  return {
    publish,
    shown,
    openSession,
    openWindow,
    refreshTray,
    dispose,
    setForeground: (value: boolean) => (foreground = value),
  }
}

it("前置失败的通知只展示项目名和事件，并唤回主窗口", async () => {
  const f = fixture()
  await f.publish({ type: "run", run: run({ reason: "private-failure-details" }) })
  expect(f.shown.map(({ title, body }) => ({ title, body }))).toEqual([
    { title: "PigClaude", body: "定时任务失败 · Report" },
  ])
  f.shown[0]?.click()
  expect(f.openWindow).toHaveBeenCalledOnce()
  expect(f.openSession).not.toHaveBeenCalled()
})

it("定时运行已有会话终态通知时不重复，未进入回合的失败仍跳到对应会话", async () => {
  const f = fixture()
  await f.publish({
    type: "run",
    run: run({ sessionId: "covered-session", sessionNoticeHandled: true }),
  })
  expect(f.shown).toHaveLength(0)
  await f.publish({ type: "run", run: run({ sessionId: "failed-before-turn" }) })
  expect(f.shown.map(({ body }) => body)).toEqual(["定时任务失败 · Report"])
  f.shown[0]?.click()
  expect(f.openSession).toHaveBeenCalledExactlyOnceWith("failed-before-turn")
})

it("前台不会消耗提醒，同类原因跨任务去重，另一原因仍单独提醒", async () => {
  const f = fixture()
  const skipped = run({ status: "skipped", reason: "MEMBERSHIP_REQUIRED" })
  f.setForeground(true)
  await f.publish({ type: "run", run: skipped })
  expect(f.shown).toHaveLength(0)
  f.setForeground(false)
  // 两个几乎同时提交的结果只提醒一次。
  await Promise.all([
    f.publish({ type: "run", run: skipped }),
    f.publish({ type: "run", run: run({ ...skipped, id: "run-b", taskId: "task-b" }) }),
  ])
  await f.publish({ type: "run", run: run({ status: "skipped", reason: "NO_AVAILABLE_ACCOUNT" }) })
  expect(f.shown.map(({ body }) => body)).toEqual([
    "定时任务已跳过 · Report",
    "定时任务已跳过 · Report",
  ])
  expect(f.shown.map(({ body }) => body).join(" ")).not.toMatch(/MEMBERSHIP|ACCOUNT/)
})

it("任务变化刷新托盘，进行中和退出中止不提醒，销毁后停止投递", async () => {
  const f = fixture()
  await f.publish({ type: "tasks" })
  expect(f.refreshTray).toHaveBeenCalledOnce()
  await f.publish({ type: "run", run: run({ status: "running" }) })
  await f.publish({ type: "run", run: run({ status: "stopped", reason: "APP_STOPPED" }) })
  expect(f.shown).toHaveLength(0)
  await f.publish({ type: "run", run: run({ status: "succeeded", reason: null }) })
  expect(f.shown.map(({ body }) => body)).toEqual(["定时任务已完成 · Report"])
  const pending = f.publish({ type: "run", run: run({ status: "succeeded", reason: null }) })
  f.dispose()
  await pending
  await f.publish({ type: "tasks" })
  expect(f.shown).toHaveLength(1)
  expect(f.refreshTray).toHaveBeenCalledOnce()
})
