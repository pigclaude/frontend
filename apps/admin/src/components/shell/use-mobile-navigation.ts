// 负责在保留原侧栏 DOM 与断点尺寸的前提下，管理移动抽屉的焦点和键盘边界。
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"

/** 管理移动导航状态；关闭时归还可见焦点，桌面恢复普通导航，菜单 portal 自行处理键盘。 */
export function useMobileNavigation(isMobile: boolean) {
  const [sideOpen, setSideOpen] = useState(false)
  const sideRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const mobileOpen = isMobile && sideOpen
  const restoreToggleFocus = useCallback(() => toggleRef.current?.focus(), [])
  const closeSide = useCallback(() => setSideOpen(false), [])

  useLayoutEffect(() => {
    const closing = wasOpen.current && !mobileOpen
    wasOpen.current = mobileOpen
    if (!isMobile) {
      setSideOpen(false)
      return
    }
    const side = sideRef.current
    if (mobileOpen) {
      const target =
        side?.querySelector<HTMLElement>('[aria-current="page"]') ??
        side?.querySelector<HTMLElement>("a[href]")
      target?.focus()
    } else if (closing || side?.contains(document.activeElement)) {
      toggleRef.current?.focus()
    }
  }, [isMobile, mobileOpen])

  function onSideKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Radix 菜单通过 portal 渲染，其事件仍沿 React 树冒泡；交还菜单自己的焦点层处理。
    if (event.defaultPrevented || !sideRef.current?.contains(event.target as Node)) return
    if (event.key === "Escape") {
      if (!mobileOpen) return
      event.preventDefault()
      closeSide()
    }
    if (event.key !== "Tab" || !mobileOpen) return
    const targets = sideRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex="0"]',
    )
    const first = targets[0]
    const last = targets[targets.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return {
    sideOpen,
    setSideOpen,
    mobileOpen,
    closeSide,
    sideRef,
    toggleRef,
    onSideKeyDown,
    restoreToggleFocus,
  }
}
