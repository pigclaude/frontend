// 从受信 IPC 入口验证计划保存、完全访问确认、立即运行及按任务删除已结束的记录。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ScheduledTaskRunsPage,
} from "../../scheduled-tasks-contract"
import { registerScheduledTasksIpc } from "./ipc"
import { ScheduledTaskService } from "./service"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
const native = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
  window: {},
}))

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, listener: Handler) => native.handlers.set(channel, listener),
  },
  BrowserWindow: { fromWebContents: () => native.window },
  dialog: { showMessageBox: native.showMessageBox },
}))

const trusted = {} as IpcMainInvokeEvent
const untrusted = {} as IpcMainInvokeEvent
let directory: string
let service: ScheduledTaskService

beforeEach(async () => {
  native.handlers.clear()
  native.showMessageBox.mockClear()
  directory = await mkdtemp(join(tmpdir(), "pigclaude-scheduled-ipc-"))
  service = new ScheduledTaskService({
    filePath: join(directory, "tasks.json"),
    run: async () => ({
      status: "succeeded",
      sessionId: "fixture-session",
      accountId: "account-1",
    }),
  })
  registerScheduledTasksIpc({ getService: () => service, isTrusted: (event) => event === trusted })
})

afterEach(async () => {
  await service.dispose()
  await rm(directory, { recursive: true, force: true })
})

function invoke(command: string, sender: IpcMainInvokeEvent, ...args: unknown[]) {
  const handler = native.handlers.get("pigclaude:scheduled-tasks-" + command)
  if (!handler) throw new Error("未注册的定时任务 IPC：" + command)
  return handler(sender, ...args)
}

function config(
  permissionMode: ScheduledTaskInput["permissionMode"] = "default",
): ScheduledTaskInput {
  return {
    projectPath: directory,
    prompt: "检查测试结果",
    rule: { kind: "daily", time: "09:00" },
    endsAt: null,
    enabled: false,
    model: null,
    permissionMode,
    accountId: null,
  }
}

it("校验受信窗口和规则，完全访问由原生窗口确认后才落盘", async () => {
  await expect(invoke("list", untrusted)).rejects.toThrow("UNTRUSTED_SCHEDULE_REQUEST")
  await expect(
    invoke("create", trusted, { ...config("bypassPermissions"), projectPath: "relative" }),
  ).rejects.toThrow("SCHEDULE_TASK_INVALID")
  expect(native.showMessageBox).not.toHaveBeenCalled()
  native.showMessageBox.mockResolvedValueOnce({ response: 0 })
  await expect(invoke("create", trusted, config("bypassPermissions"))).resolves.toBeNull()
  expect(await service.list()).toEqual([])

  native.showMessageBox.mockResolvedValueOnce({ response: 1 })
  const saved = (await invoke("create", trusted, config("bypassPermissions"))) as ScheduledTask
  expect(saved.permissionMode).toBe("bypassPermissions")
  expect(native.showMessageBox).toHaveBeenLastCalledWith(
    native.window,
    expect.objectContaining({ type: "warning", defaultId: 0, cancelId: 0 }),
  )
  native.showMessageBox.mockResolvedValueOnce({ response: 0 })
  await expect(
    invoke("update", trusted, saved.id, { ...config("bypassPermissions"), prompt: "编辑" }),
  ).resolves.toBeNull()
  expect((await service.list())[0]?.prompt).toBe("检查测试结果")
})

it("更新、启停、立即运行和按页读取都走真实服务，删除只影响该任务已完成的记录", async () => {
  const first = (await invoke("create", trusted, config())) as ScheduledTask
  const second = (await invoke("create", trusted, config())) as ScheduledTask
  await expect(
    invoke("update", trusted, first.id, { ...config(), prompt: "编辑" }),
  ).resolves.toMatchObject({
    prompt: "编辑",
  })
  await expect(invoke("set-enabled", trusted, first.id, true)).resolves.toMatchObject({
    enabled: true,
  })
  await expect(invoke("set-enabled", trusted, first.id, false)).resolves.toMatchObject({
    enabled: false,
    nextRunAt: null,
  })
  const run = (await invoke("run-now", trusted, first.id)) as ScheduledTaskRun
  expect(run).toMatchObject({ source: "manual", taskId: first.id })
  await expect(invoke("runs", trusted, first.id, -1, 20)).rejects.toThrow(
    "SCHEDULE_RUN_PAGE_INVALID",
  )
  await vi.waitFor(async () => {
    const page = (await invoke("runs", trusted, first.id, 0, 20)) as ScheduledTaskRunsPage
    expect(page).toMatchObject({
      total: 1,
      runs: [{ status: "succeeded", sessionId: "fixture-session", accountId: "account-1" }],
    })
  })
  await expect(invoke("remove-run", trusted, second.id, run.id)).rejects.toThrow(
    "SCHEDULE_RUN_NOT_FOUND",
  )
  await invoke("remove-run", trusted, first.id, run.id)
  expect(await invoke("runs", trusted, first.id, 0, 20)).toEqual({ runs: [], total: 0 })
  expect(await invoke("list", trusted)).toContainEqual(
    expect.objectContaining({ id: first.id, lastSessionId: "fixture-session", runCount: 1 }),
  )
  await invoke("remove", trusted, second.id)
  expect(await service.list()).toHaveLength(1)
})
