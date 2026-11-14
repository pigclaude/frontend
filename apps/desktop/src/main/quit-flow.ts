// 负责把退出流程接到 Electron：退出、关闭主窗口和刷新页面前确认进行中的工作和未保存的文件，
// 确认后按顺序清理再退出。
import { app, type BrowserWindow } from "electron"
import { createQuitConfirmation } from "./quit-confirmation"
import { askBeforeReload, askToLeave, showQuitFailure } from "./quit-prompt"
import type { SessionPendingWork } from "./session/session-host-support"
import { createQuitCoordinator } from "./shutdown"
import { guardReload } from "./unsaved-guard"
import type { UnsavedFiles } from "./workbench/unsaved-files"

/** 退出流程的依赖：当前会中断的工作、未保存的文件、主窗口、清理步骤，以及开始清理前要做的事。 */
export type QuitFlowOptions = {
  pendingWork: () => SessionPendingWork
  unsaved: UnsavedFiles
  mainWindow: () => BrowserWindow | null
  shutdown: () => Promise<void>
  onBeforeShutdown: () => void
}

/**
 * 注册应用的退出流程：Windows 和 Linux 关掉最后一个窗口即退出；退出前有工作或未保存的文件时先确认，
 * 取消就不退出。返回给主窗口装上关窗和刷新确认的函数。
 */
export function installQuitFlow(options: QuitFlowOptions): (window: BrowserWindow) => void {
  const page = () => {
    const window = options.mainWindow()
    return window && !window.isDestroyed() ? window.webContents : null
  }
  const confirmation = createQuitConfirmation({
    pendingWork: () => ({ ...options.pendingWork(), unsavedFiles: options.unsaved.count() }),
    ask: (work, action) => askToLeave(options.mainWindow(), work, action),
    saveFiles: async () => {
      const contents = page()
      return contents ? options.unsaved.save(contents) : true
    },
    discardFiles: async () => {
      const contents = page()
      if (contents) await options.unsaved.discard(contents)
    },
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
      onFailure: (reason) => {
        confirmation.reset()
        showQuitFailure(reason)
      },
      onBeforeShutdown: options.onBeforeShutdown,
    }),
  )
  return (window) => {
    confirmation.guardClose(window)
    guardReload(window.webContents, {
      leaving: () => confirmation.leaving(),
      unsavedFiles: () => options.unsaved.count(window.webContents),
      saveFiles: () => options.unsaved.save(window.webContents),
      ask: (unsavedFiles) => askBeforeReload(window, unsavedFiles),
    })
  }
}
