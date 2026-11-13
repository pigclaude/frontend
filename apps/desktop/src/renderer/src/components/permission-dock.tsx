// 负责把权限卡片挂到输入框上方：Pigcode 的会话视图没有审批插槽，这里在输入区容器里插入自己的
// 宿主节点，让卡片和输入框一起参与布局，时间线滚动时卡片仍停在输入框上方。

import { useLayoutEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** 权限卡片的宿主；输入区还没出现时不渲染。 */
export type PermissionDockProps = {
  /** 会话页面根节点，宿主插在它里面的 .composer-wrap 开头。 */
  container: HTMLElement | null
  /** 会话结构变化时重新查找输入区；草稿页没有这个容器。 */
  mounted: string | null
  children: ReactNode
}

/** 在输入区上方渲染子节点。 */
export function PermissionDock({ container, mounted, children }: PermissionDockProps) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const wrap = container?.querySelector(".composer-wrap")
    if (!wrap) {
      setHost(null)
      return
    }
    const node = document.createElement("div")
    node.className = "perm-host"
    wrap.insertBefore(node, wrap.firstChild)
    setHost(node)
    return () => {
      node.remove()
    }
  }, [container, mounted])

  return host === null ? null : createPortal(children, host)
}
