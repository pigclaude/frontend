// 负责外壳的全局快捷键与鼠标侧键：⌘K 命令面板、⌘N 新会话、⌘B 侧栏、⌘, 设置、历史前进后退与 ⌘1…9 打开会话。
// 按键规则与 Pigcode 外壳一致：输入框里不拦截编辑用的组合键，对话框打开时不叠命令面板。
import { useEffect, useRef } from "react"
import { historyStep, threadShortcutIndex } from "@pigclaude/ui-shell"

/** 快捷键触发的动作。 */
export type ShellKeyActions = {
  onBack: () => void
  onForward: () => void
  onTogglePalette: () => void
  onNewSession: () => void
  onToggleSidebar: () => void
  onOpenSettings: () => void
  /** 按 ⌘/Ctrl+数字打开侧栏里从上往下数的第 n 个会话；没有时返回 false。 */
  onOpenNth: (index: number) => boolean
  onCloseDrawer: () => void
}

function isEditing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return (
    element?.isContentEditable === true ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName ?? "")
  )
}

/** 注册外壳快捷键；动作总是取最新的一份，不必因为回调变化重新注册。 */
export function useShellKeys(actions: ShellKeyActions, enableThreadKeys: boolean): void {
  const latest = useRef(actions)
  latest.current = actions

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const current = latest.current
      if (event.key === "Escape") current.onCloseDrawer()
      const editing = isEditing(event.target)
      // 保留 Pigcode 的 macOS 快捷键，同时支持产品约定的 Alt+方向键。
      const step = historyStep(event) ?? historyStep(event, false)
      if (step) {
        if (editing) return
        event.preventDefault()
        if (step === "back") current.onBack()
        else current.onForward()
        return
      }
      const index = enableThreadKeys ? threadShortcutIndex(event) : null
      if (index !== null) {
        if (current.onOpenNth(index)) event.preventDefault()
        return
      }
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key === "k") {
        event.preventDefault()
        if (document.querySelector(".dialog")) return
        current.onTogglePalette()
        return
      }
      if (editing) return
      if (key === "n") {
        event.preventDefault()
        current.onNewSession()
      } else if (key === "b") {
        event.preventDefault()
        current.onToggleSidebar()
      } else if (event.key === ",") {
        event.preventDefault()
        current.onOpenSettings()
      }
    }
    function onMouseUp(event: MouseEvent): void {
      if (event.button === 3) {
        event.preventDefault()
        latest.current.onBack()
      } else if (event.button === 4) {
        event.preventDefault()
        latest.current.onForward()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [enableThreadKeys])
}
