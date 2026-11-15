// 将受信主窗口的定时任务操作交给本机调度服务，完全访问通过原生对话框确认。

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron"
import { scheduledTaskChannelPrefix, type ScheduledTaskInput } from "../../scheduled-tasks-contract"
import type { ScheduledTaskService } from "./service"
import { maximumScheduledTaskRuns, parseScheduledTaskInput } from "./store"

type Options = {
  getService: () => ScheduledTaskService | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}

const visibleErrors = new Set([
  "SCHEDULE_TASK_INVALID",
  "SCHEDULE_TASK_NOT_FOUND",
  "SCHEDULE_INTERVAL_TOO_SHORT",
  "SCHEDULE_RUN_PAGE_INVALID",
  "SCHEDULE_RUN_ACTIVE",
  "SCHEDULE_RUN_NOT_FOUND",
  "SCHEDULE_SERVICE_CLOSED",
  "SCHEDULE_FILE_INVALID",
  "SCHEDULE_SERVICE_UNAVAILABLE",
  "UNTRUSTED_SCHEDULE_REQUEST",
])

/** 注册本机任务命令。只有当前受信窗口可读取任务提示词或修改计划。 */
export function registerScheduledTasksIpc(options: Options): void {
  function assertTrusted(event: IpcMainInvokeEvent): void {
    if (!options.isTrusted(event)) throw new Error("UNTRUSTED_SCHEDULE_REQUEST")
  }

  function handle(
    name: string,
    action: (service: ScheduledTaskService, args: unknown[], event: IpcMainInvokeEvent) => unknown,
  ): void {
    ipcMain.handle(scheduledTaskChannelPrefix + name, async (event, ...args: unknown[]) => {
      assertTrusted(event)
      const service = options.getService()
      if (!service) throw new Error("SCHEDULE_SERVICE_UNAVAILABLE")
      try {
        return await action(service, args, event)
      } catch (cause: unknown) {
        const code = cause instanceof Error ? cause.message : ""
        throw new Error(visibleErrors.has(code) ? code : "SCHEDULE_OPERATION_FAILED")
      }
    })
  }

  async function maySave(input: ScheduledTaskInput, event: IpcMainInvokeEvent): Promise<boolean> {
    if (input.permissionMode !== "bypassPermissions") return true
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error("UNTRUSTED_SCHEDULE_REQUEST")
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      title: "确认完全访问",
      message: "允许此定时任务以完全访问权限运行？",
      detail: `项目 ${JSON.stringify(input.projectPath)}\n\n任务会在无人值守时运行，可以修改文件或执行命令。`,
      buttons: ["返回", "保存完全访问任务"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    assertTrusted(event)
    return response === 1
  }

  handle("list", (service) => service.list())
  handle("create", async (service, [value], event) => {
    const input = parseScheduledTaskInput(value)
    return (await maySave(input, event)) ? service.create(input) : null
  })
  handle("update", async (service, [value, fields], event) => {
    const id = taskId(value)
    const input = parseScheduledTaskInput(fields)
    return (await maySave(input, event)) ? service.update(id, input) : null
  })
  handle("set-enabled", (service, [id, enabled]) => {
    if (typeof enabled !== "boolean") throw new Error("SCHEDULE_TASK_INVALID")
    return service.setEnabled(taskId(id), enabled)
  })
  handle("remove", (service, [id]) => service.remove(taskId(id)))
  handle("run-now", (service, [id]) => service.runNow(taskId(id)))
  handle("runs", (service, [id, offset, limit]) => {
    if (
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > maximumScheduledTaskRuns
    )
      throw new Error("SCHEDULE_RUN_PAGE_INVALID")
    return service.runs(taskId(id), offset, limit)
  })
  handle("remove-run", (service, [task, run]) => service.removeRun(taskId(task), taskId(run)))
}

function taskId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error("SCHEDULE_TASK_INVALID")
  return value
}
