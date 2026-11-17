// 从主侧栏验证定时任务的创建、编辑、筛选、立即运行及历史到会话的入口。
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

it("定时任务从主侧栏打开，设置侧栏没有重复入口", async () => {
  installFakeDesktopBridge()
  if (!window.pigclaude) throw new Error("桌面夹具尚未装配")
  window.pigclaude.scheduledTasks = fakeTasks([])
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await click("定时任务")
  expect(app.container.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe("定时任务")
  expect(app.container.querySelector('[data-screen="scheduled-tasks"]')).not.toBeNull()
  const settings = app.container.querySelector<HTMLElement>('button[aria-label="设置"]')
  await clickButton(settings ?? undefined, "设置")
  await flush()
  expect(buttonNamed("定时任务", app.container)).toBeUndefined()
})

function task(id: string, prompt: string, options: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id,
    projectPath: "/work/api",
    title: prompt,
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

async function openSchedules(bridge: ScheduledTasksBridge) {
  installFakeDesktopBridge()
  const desktop = window.pigclaude
  if (!desktop?.session) throw new Error("桌面夹具尚未装配")
  window.history.replaceState({}, "", "/?screen=chat-new")
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

async function clickMatching(selector: string, name: RegExp): Promise<void> {
  const control = [...document.querySelectorAll<HTMLElement>(selector)].find((node) =>
    name.test(node.textContent?.trim() ?? ""),
  )
  await clickButton(control, name.source)
  await flush()
}

async function cardAction(id: string, name: string): Promise<void> {
  const more = app.container.querySelector<HTMLElement>(
    `[data-schedule="${id}"] .schedule-card-menu`,
  )
  await clickButton(more ?? undefined, "更多操作")
  await flush()
  await clickMatching('[role="menuitem"]', new RegExp(`^${name}$`))
}

async function chooseMode(current: string, next: RegExp): Promise<void> {
  const model = app.container.querySelector<HTMLButtonElement>('button[aria-label^="Agent 与模型"]')
  await clickButton(model ?? undefined, "Agent 与模型")
  await flush()
  const permission = document.querySelector<HTMLElement>(`button[aria-label="权限: ${current}"]`)
  await clickButton(permission ?? undefined, "权限")
  await flush()
  await clickMatching('[role="menuitemradio"]', next)
}

it("筛选任务、立即运行、暂停，再从历史打开会话并向服务发出删除和翻页请求", async () => {
  const active = task("task-active", "检查构建")
  const paused = task("task-paused", "整理变更", { enabled: false, nextRunAt: null })
  const bridge = fakeTasks([active, paused])
  const { status } = await openSchedules(bridge)
  await click("已暂停")
  expect(app.container.textContent).toContain(paused.prompt)
  expect(app.container.textContent).not.toContain(active.prompt)
  await click("运行中")
  await cardAction(active.id, "立即运行")
  expect(bridge.runNow).toHaveBeenCalledExactlyOnceWith(active.id)
  expect(app.container.textContent).toContain("已启动任务")
  await cardAction(active.id, "暂停")
  expect(bridge.setEnabled).toHaveBeenCalledExactlyOnceWith(active.id, false)
  expect(app.container.textContent).toContain("没有符合条件的任务")

  await click("全部")
  const updated = [...app.container.querySelectorAll("article")].find((node) =>
    node.textContent?.includes(active.prompt),
  )
  if (!updated) throw new Error("没有更新后的任务")
  await click(active.prompt, updated)
  await click("历史")
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
  await openSchedules(bridge)
  await click("新建任务")
  const prompt = app.container.querySelector<HTMLElement>(".composer .tiptap")
  const title = app.container.querySelector<HTMLInputElement>(".schedule-form input.input")
  if (!prompt || !title) throw new Error("没有任务标题或指令输入框")
  await act(async () => {
    await userEvent.type(title, "构建日报")
    await userEvent.type(prompt, "记录最新构建结果")
  })
  const project = app.container.querySelector<HTMLElement>("button.draft-project")
  await clickButton(project ?? undefined, "项目")
  await flush()
  await clickMatching('[role="menuitem"]', /\/work\/web/)
  await chooseMode("监督审批", /完全访问/)
  await click("启用完全访问", document)
  await click("创建任务")
  expect(prompt.textContent).toBe("记录最新构建结果")
  expect(bridge.create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: "构建日报",
      enabled: true,
      endsAt: null,
      permissionMode: "bypassPermissions",
      projectPath: "/work/web",
      prompt: "记录最新构建结果",
      draft: expect.objectContaining({ document: expect.any(String) }),
      rule: { kind: "daily", time: "09:00" },
    }),
  )
  await click("创建任务")
  await click("构建日报")
  expect(app.container.querySelector(".composer .tiptap")?.textContent).toBe("记录最新构建结果")
  await chooseMode("完全访问", /接受编辑/)
  await click("保存")
  expect(bridge.update).toHaveBeenCalledExactlyOnceWith(
    "created",
    expect.objectContaining({ permissionMode: "acceptEdits", enabled: true }),
  )
})
