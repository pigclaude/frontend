// 负责把已有主窗口从隐藏或最小化状态唤回，保留窗口里的会话与草稿。

import type { BrowserWindow } from "electron"

type ShowableWindow = Pick<
  BrowserWindow,
  "isDestroyed" | "isMinimized" | "restore" | "show" | "focus"
>

type FirstPaintWindow = ShowableWindow & {
  once(event: "ready-to-show", listener: () => void): unknown
}

const firstPaints = new WeakMap<ShowableWindow, { foregroundRequested: boolean }>()

/** 唤回未销毁的主窗口并聚焦。渲染首帧前先记住请求。 */
export function showMainWindow(window: ShowableWindow | null): boolean {
  if (!window || window.isDestroyed()) return false
  const firstPaint = firstPaints.get(window)
  if (firstPaint) {
    firstPaint.foregroundRequested = true
    return true
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

/** 管理托盘、Dock 和再次启动的唤回入口；清理失败后允许打开原窗口重试退出。 */
export function createMainWindowVisibility(
  window: () => ShowableWindow | null,
  createWindow: () => void,
) {
  let phase: "running" | "shutting_down" | "cleanup_failed" = "running"
  const restoreExisting = (): boolean => phase !== "shutting_down" && showMainWindow(window())
  return {
    /** 加载页面前登记首帧，所有唤回入口都等首帧后再显示该窗口。 */
    trackFirstPaint(created: FirstPaintWindow, showOnFirstPaint: boolean) {
      const firstPaint = { foregroundRequested: false }
      firstPaints.set(created, firstPaint)
      created.once("ready-to-show", () => {
        firstPaints.delete(created)
        if (phase === "shutting_down" || window() !== created || created.isDestroyed()) return
        if (firstPaint.foregroundRequested) showMainWindow(created)
        else if (showOnFirstPaint) created.show()
      })
    },
    /** 唤回现有窗口；关闭期间不改变窗口状态。 */
    restoreExisting,
    /** 正常运行时没有窗口才创建，退出一旦开始就只唤回已有窗口。 */
    restore() {
      if (!restoreExisting() && phase === "running") createWindow()
    },
    /** 开始清理时禁止托盘等入口唤回窗口，重试时也适用。 */
    startShutdown() {
      phase = "shutting_down"
    },
    /** 失败时恢复现有窗口的操作入口，清理过程中释放的服务不重新初始化。 */
    shutdownFailed() {
      phase = "cleanup_failed"
      restoreExisting()
    },
    /** 一旦开始过退出，之后的异步启动任务不再初始化服务。 */
    shutdownStarted() {
      return phase !== "running"
    },
  }
}
