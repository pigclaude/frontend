// 负责把已有主窗口从隐藏或最小化状态唤回，保留窗口里的会话与草稿。

import type { BrowserWindow } from "electron"

/** 唤回未销毁的主窗口并聚焦；没有可唤回的窗口时返回 false。 */
export function showMainWindow(window: BrowserWindow | null): boolean {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}
