// 负责把退出流程接到 Electron：退出和关闭主窗口前确认进行中的工作，确认后按顺序清理再退出。
import { app, type BrowserWindow } from "electron"
import { createQuitConfirmation } from "./quit-confirmation"
import { askToLeave, showQuitFailure } from "./quit-prompt"
import type { SessionPendingWork } from "./session/session-host-support"
import { createQuitCoordinator } from "./shutdown"

/** 退出流程的依赖：当前会中断的工作、主窗口、清理步骤，以及开始清理前要做的事。 */
export type QuitFlowOptions = {
  pendingWork: () => SessionPendingWork
  mainWindow: () => BrowserWindow | null
  shutdown: () => Promise<void>
  onBeforeShutdown: () => void
}

/**
 * 注册应用的退出流程：Windows 和 Linux 关掉最后一个窗口即退出；退出前有工作时先确认，取消就不退出。
 * 返回给主窗口装上关窗确认的函数。
 */
export function installQuitFlow(options: QuitFlowOptions): (window: BrowserWindow) => void {
  const confirmation = createQuitConfirmation({
    pendingWork: options.pendingWork,
    ask: (work, action) => askToLeave(options.mainWindow(), work, action),
  })
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
  app.on(
    "before-quit",
    createQuitCoordinator({
      confirm: () => confirmation.confirm("quit"),
      shutdown: options.shutdown,
      quit: () => app.quit(),
      onFailure: showQuitFailure,
      onBeforeShutdown: options.onBeforeShutdown,
    }),
  )
  return (window) => confirmation.guardClose(window)
}
