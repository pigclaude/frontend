// 负责把退出流程接到 Electron：退出、关闭主窗口和刷新页面前确认进行中的工作和未保存的文件，
// 确认后按顺序清理再退出。
import { app, powerMonitor, type BrowserWindow } from "electron"
import type { ScheduledTaskSummary } from "../scheduled-tasks-contract"
import { showMainWindow } from "./main-window-visibility"
import { createQuitConfirmation } from "./quit-confirmation"
import { askBeforeReload, askToLeave, showQuitFailure } from "./quit-prompt"
import type { SessionPendingWork } from "./session/session-host-support"
import { createQuitCoordinator, type QuitEvent, type QuitMode } from "./shutdown"
import { guardReload } from "./unsaved-guard"
import type { UnsavedFiles } from "./workbench/unsaved-files"

/**
 * 退出流程的依赖：当前会中断的工作、未保存的文件、主窗口、清理步骤、开始清理前要做的事，
 * 清理完成后的最后一步，以及用户取消退出时要做的事。
 */
export type QuitFlowOptions = {
  pendingWork: () => SessionPendingWork
  /** 退出前列出启用中的定时任务，与会话工作分别展示。 */
  scheduledTasks?: () => ScheduledTaskSummary["enabled"]
  unsaved: UnsavedFiles
  mainWindow: () => BrowserWindow | null
  /** 用户关闭主窗口时是否只隐藏；真正退出仍走统一确认。 */
  closeToTray?: () => boolean
  /** 在 Electron 就绪后接手 Linux 和 macOS 的系统关机事件。 */
  watchPowerShutdown?: (listener: (event: QuitEvent) => void) => void
  shutdown: () => Promise<void>
  onBeforeShutdown: () => void
  /** 清理报错后恢复应用操作，允许用户再次退出。 */
  onShutdownFailure?: () => void
  finishQuit: (mode: QuitMode) => void
  onCancel: () => void
}

/** 在 Electron 就绪后接手 Linux 和 macOS 的关机事件；启动失败时不再注册。 */
export function watchPowerShutdown(listener: (event: QuitEvent) => void): void {
  void app
    .whenReady()
    .then(() => {
      // Electron 43 的类型声明没列出事件参数，但 powerMonitor 会传入可阻止关机的事件。
      powerMonitor.on("shutdown", (event?: QuitEvent) => listener(event ?? { preventDefault() {} }))
    })
    .catch(() => undefined)
}

/**
 * 注册应用的退出流程：真正关掉主窗口时退出；退出前有工作或未保存的文件时先确认，
 * 取消就不退出。返回给主窗口装上关窗和刷新确认的函数。
 */
export function installQuitFlow(options: QuitFlowOptions): (window: BrowserWindow) => void {
  let activePrompt: AbortController | null = null
  const page = () => {
    const window = options.mainWindow()
    return window && !window.isDestroyed() ? window.webContents : null
  }
  const confirmation = createQuitConfirmation({
    pendingWork: () => ({
      ...options.pendingWork(),
      unsavedFiles: options.unsaved.count(),
      ...(options.scheduledTasks === undefined ? {} : { scheduledTasks: options.scheduledTasks() }),
    }),
    ask: async (work, action) => {
      const window = options.mainWindow()
      if (action === "quit") showMainWindow(window)
      const prompt = new AbortController()
      activePrompt = prompt
      try {
        return await askToLeave(window, work, action, prompt.signal)
      } finally {
        if (activePrompt === prompt) activePrompt = null
      }
    },
    saveFiles: async () => {
      const contents = page()
      return contents ? options.unsaved.save(contents) : true
    },
    discardFiles: async () => {
      const contents = page()
      if (contents) await options.unsaved.discard(contents)
    },
  })
  const quitting = createQuitCoordinator({
    confirm: () => {
      const answer = confirmation.confirm("quit")
      if (answer === true) return true
      return answer.then((confirmed) => {
        if (!confirmed && !confirmation.leaving()) options.onCancel()
        return confirmed
      })
    },
    shutdown: options.shutdown,
    quit: options.finishQuit,
    onFailure: (reason) => {
      if (reason !== "timeout") {
        confirmation.reset()
        options.onShutdownFailure?.()
      }
      showQuitFailure(reason)
    },
    onBeforeShutdown: options.onBeforeShutdown,
  })
  app.on("before-quit", quitting.beforeQuit)
  const quitWhenIdle = () => {
    if (quitting.canStartQuit()) app.quit()
  }
  app.on("window-all-closed", quitWhenIdle)
  const systemQuit = () => {
    confirmation.allowSystemShutdown()
    activePrompt?.abort()
    quitting.systemQuit()
  }
  options.watchPowerShutdown?.((event) => {
    event.preventDefault()
    systemQuit()
  })
  return (window) => {
    confirmation.guardClose(window, options.closeToTray)
    // 能力插件的隐藏窗口还活着时，Electron 不会发出 window-all-closed。
    window.on("closed", quitWhenIdle)
    // Windows 可能取消会话结束查询；只在系统确认注销或关机后才清理。
    window.on("session-end", systemQuit)
    guardReload(window.webContents, {
      leaving: () => confirmation.leaving(),
      unsavedFiles: () => options.unsaved.count(window.webContents),
      saveFiles: () => options.unsaved.save(window.webContents),
      ask: (unsavedFiles) => askBeforeReload(window, unsavedFiles),
    })
  }
}
