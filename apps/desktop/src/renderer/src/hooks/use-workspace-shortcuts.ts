// 负责聊天窗口打开终端与工作台的键盘快捷键。

import { useEffect } from "react"

/** 只在已连接的聊天工作台接收快捷键，避免拦截对话框或已处理的事件。 */
export function useWorkspaceShortcuts(
  enabled: boolean,
  root: string | null,
  toggleTerminal: () => void,
  toggleWorkbench: () => void,
): void {
  useEffect(() => {
    if (!enabled) return
    function onKey(event: KeyboardEvent) {
      const terminal = event.ctrlKey && event.key === "`" && root !== null
      const workbench = event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey)
      if (!terminal && !workbench) return
      if (event.altKey || event.defaultPrevented || document.querySelector("[role='dialog']"))
        return
      event.preventDefault()
      if (terminal) toggleTerminal()
      else toggleWorkbench()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [enabled, root, toggleTerminal, toggleWorkbench])
}
