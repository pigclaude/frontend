// 通过设置侧栏验证任务编辑、状态筛选、立即运行及历史到会话的真实页面入口。
// @vitest-environment jsdom

import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTasksBridge,
} from "../../scheduled-tasks-contract"
import { DesktopApp } from "./app"
import { buttonNamed, clickButton } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { idleStatus } from "./test-support/session-bridge-fake"

const app = desktopAppRoot()

function task(id: string, prompt: string, options: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id,
    projectPath: "/work/api",
    prompt,
    rule: { kind: "daily", time: "09:00" },
    endsAt: null,
    enabled: true,
    model: null,
    permissionMode: "default",
    accountId: null,
    nextRunAt: "2026-11-20T09:00:00.000Z",
    lastRunAt: null,
    lastSessionId: null,
    runCount: 0,
    ...options,
  }
}

const result: ScheduledTaskRun = {
  id: "run-1",
  taskId: "task-active",
  triggerSequence: 2,
  source: "schedule",
  status: "succeeded",
  scheduledAt: "2026-11-14T09:00:00.000Z",
  triggeredAt: "2026-11-14T09:00:00.000Z",
  finishedAt: "2026-11-14T09:02:00.000Z",
  reason: null,
  sessionId: "recorded-session",
  accountId: "acc-work",
  deniedApprovals: 0,
}

function fakeTasks(initial: ScheduledTask[]) {
  let tasks = initial
  const events = new Set<() => void>()
  const notify = () => events.forEach((listener) => listener())
  let history = [
    result,
    {
      ...result,
      id: "run-2",
      source: "manual" as const,
      status: "skipped" as const,
      sessionId: null,
      accountId: null,
      reason: "PROJECT_UNAVAILABLE",
    },
    { ...result, id: "run-3", sessionId: null, reason: "private error /private/fixture" },
  ]
  const bridge = {
    list: vi.fn(async () => structuredClone(tasks)),
    create: vi.fn<ScheduledTasksBridge["create"]>(async (input) => {
      const created = task("created", input.prompt, input)
      tasks = [...tasks, created]
      notify()
      return created
    }),
    update: vi.fn(async (id: string, input: ScheduledTaskInput) => {
      const updated = task(id, input.prompt, input)
      tasks = tasks.map((item) => (item.id === id ? updated : item))
      notify()
      return updated
    }),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      const record = tasks.find((item) => item.id === id)
      if (!record) throw new Error("SCHEDULE_TASK_NOT_FOUND")
      const updated = { ...record, enabled, nextRunAt: enabled ? result.scheduledAt : null }
      tasks = tasks.map((item) => (item.id === id ? updated : item))
      notify()
      return updated
    }),
    remove: vi.fn(async (id: string) => {
      tasks = tasks.filter((item) => item.id !== id)
      notify()
    }),
    runNow: vi.fn(async (id: string) => ({
      ...result,
      taskId: id,
      source: "manual" as const,
      status: "running" as const,
    })),
    runs: vi.fn(async (_id: string, offset: number) => ({
      runs: offset === 0 ? history : [],
      total: history.length + 20,
    })),
    removeRun: vi.fn(async (_taskId: string, runId: string) => {
      history = history.filter(({ id }) => id !== runId)
      notify()
    }),
    subscribe: (listener: () => void) => {
      events.add(listener)
      return () => void events.delete(listener)
    },
  } satisfies ScheduledTasksBridge
  return bridge
}

async function openSettings(bridge: ScheduledTasksBridge) {
  installFakeDesktopBridge()
  const desktop = window.pigclaude
  if (!desktop?.session) throw new Error("桌面夹具尚未装配")
  window.history.replaceState({}, "", "/?screen=general")
  desktop.scheduledTasks = bridge
  const status = vi.fn(async () => idleStatus)
  desktop.session.status = status
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await click("定时任务")
  expect(app.container.querySelector("[data-screen]")?.getAttribute("data-screen")).toBe(
    "scheduled-tasks",
  )
  return { status }
}

async function click(name: string, area: ParentNode = app.container) {
  await clickButton(buttonNamed(name, area), name)
  await flush()
}

function select(label: string): HTMLSelectElement {
  const control = [...app.container.querySelectorAll("label")]
    .find((node) => node.textContent?.startsWith(label))
    ?.querySelector("select")
  if (!control) throw new Error("没有下拉框：" + label)
  return control
}

it("筛选任务、立即运行、暂停，再从历史打开会话并向服务发出删除和翻页请求", async () => {
  const active = task("task-active", "检查构建")
  const paused = task("task-paused", "整理变更", { enabled: false, nextRunAt: null })
  const bridge = fakeTasks([active, paused])
  const { status } = await openSettings(bridge)
  await click("已暂停")
  expect(app.container.textContent).toContain(paused.prompt)
  expect(app.container.textContent).not.toContain(active.prompt)
  await click("已启用")
  const card = app.container.querySelector("article")
  if (!card) throw new Error("没有启用任务")
  await click("立即运行", card)
  expect(bridge.runNow).toHaveBeenCalledExactlyOnceWith(active.id)
  expect(app.container.textContent).toContain("已请求立即运行")
  await click("暂停", card)
  expect(bridge.setEnabled).toHaveBeenCalledExactlyOnceWith(active.id, false)
  expect(app.container.textContent).toContain("没有符合此状态的任务")

  await click("全部")
  const updated = [...app.container.querySelectorAll("article")].find((node) =>
    node.textContent?.includes(active.prompt),
  )
  if (!updated) throw new Error("没有更新后的任务")
  await click("运行记录", updated)
  expect(app.container.textContent).toContain("账号：工作号")
  expect(app.container.textContent).toContain("项目目录不可用")
  expect(app.container.textContent).toContain("原因暂不可用")
  expect(app.container.textContent).not.toContain("/private/fixture")
  const next = app.container.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')
  await clickButton(next ?? undefined, "下一页")
  await flush()
  expect(bridge.runs).toHaveBeenLastCalledWith(active.id, 20, 20)
  const back = app.container.querySelector<HTMLButtonElement>('button[aria-label="上一页"]')
  await clickButton(back ?? undefined, "上一页")
  await flush()
  const skipped = app.container.querySelector('[data-run="run-2"]')
  const remove = skipped?.querySelector<HTMLButtonElement>('button[aria-label="删除记录"]')
  await clickButton(remove ?? undefined, "删除记录")
  await flush()
  expect(bridge.removeRun).toHaveBeenCalledExactlyOnceWith(active.id, "run-2")
  expect(app.container.textContent).not.toContain("项目目录不可用")

  const open = app.container.querySelector<HTMLButtonElement>('button[aria-label="跳到会话"]')
  await clickButton(open ?? undefined, "跳到会话")
  await flush()
  expect(status).toHaveBeenCalledWith({ sessionId: "recorded-session" })
})

it("取消完全访问确认后保留草稿，保存新任务后能编辑已持久化配置", async () => {
  const bridge = fakeTasks([])
  bridge.create.mockImplementationOnce(async () => null)
  await openSettings(bridge)
  await click("新建任务")
  const prompt = app.container.querySelector("textarea")
  if (!prompt) throw new Error("没有提示词输入框")
  await act(async () => {
    await userEvent.type(prompt, "记录最新构建结果")
    await userEvent.selectOptions(select("项目"), "/work/web")
    await userEvent.selectOptions(select("模型"), "claude-sonnet")
    await userEvent.selectOptions(select("Claude 账号"), "acc-work")
    await userEvent.selectOptions(select("权限档"), "bypassPermissions")
  })
  const end = app.container.querySelector<HTMLInputElement>('input[type="date"]')
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!end || !setValue) throw new Error("没有结束日期输入框")
  await act(async () => {
    setValue.call(end, "2099-12-31")
    end.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(app.container.textContent).toContain("保存时需要再次确认")
  await click("保存任务")
  expect(prompt.value).toBe("记录最新构建结果")
  expect(bridge.create).toHaveBeenCalledExactlyOnceWith({
    accountId: "acc-work",
    enabled: true,
    endsAt: new Date(2099, 11, 31, 23, 59, 59, 999).toISOString(),
    model: "claude-sonnet",
    permissionMode: "bypassPermissions",
    projectPath: "/work/web",
    prompt: "记录最新构建结果",
    rule: { kind: "daily", time: "09:00" },
  })
  await click("保存任务")
  expect(app.container.textContent).toContain("记录最新构建结果")

  await click("编辑任务")
  await act(async () => userEvent.selectOptions(select("权限档"), "acceptEdits"))
  const enabled = app.container.querySelector<HTMLElement>('[role="switch"][aria-label="启用任务"]')
  await clickButton(enabled ?? undefined, "启用任务")
  await click("保存任务")
  expect(bridge.update).toHaveBeenCalledExactlyOnceWith(
    "created",
    expect.objectContaining({ permissionMode: "acceptEdits", enabled: false }),
  )
})
