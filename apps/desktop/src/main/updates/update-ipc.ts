// 负责更新服务的 IPC：读取状态、执行动作、手动检查、改自动检查开关和打开发布页，只接受受信任的主窗口。
import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { UpdateService } from "./update-service"

/** 注册更新 IPC 需要的能力；测试里可以替换。 */
export type UpdateIpcDeps = {
  ipcMain: Pick<IpcMain, "handle">
  service: () => UpdateService | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}

/**
 * 注册更新相关 IPC。发布页地址只由主进程持有，页面只能请求「打开当前的发布页」，不能传地址；
 * 服务还没建好或发送者不受信任时，读取返回 null，其余什么都不做。
 */
export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  const serviceFor = (event: IpcMainInvokeEvent) => (deps.isTrusted(event) ? deps.service() : null)
  deps.ipcMain.handle("pigclaude:update-state", (event) => serviceFor(event)?.getState() ?? null)
  deps.ipcMain.handle(
    "pigclaude:update-action",
    async (event) => (await serviceFor(event)?.perform()) ?? null,
  )
  deps.ipcMain.handle(
    "pigclaude:update-check",
    async (event) => (await serviceFor(event)?.checkNow()) ?? { status: "error" },
  )
  deps.ipcMain.handle("pigclaude:update-auto-check", async (event, value: unknown) => {
    const service = serviceFor(event)
    if (!service || typeof value !== "boolean") return service?.getState() ?? null
    return service.setAutoCheck(value)
  })
  deps.ipcMain.handle("pigclaude:update-release-notes", async (event) => {
    await serviceFor(event)?.openReleaseNotes()
  })
}
