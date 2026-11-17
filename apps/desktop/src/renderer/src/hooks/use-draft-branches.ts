// 负责读取新会话草稿所在目录的 Git 分支：目录变化、窗口回到前台、打开分支菜单时重新读取，
// 前台时每 3 秒低频检查一次，以便终端里切了分支也能看到。
import { useCallback, useEffect, useRef, useState } from "react"
import type { WorkbenchBranches, WorkbenchBridge } from "../../../workbench-contract"

/** 草稿分支的读取结果；accept 接收切换或新建分支后主进程返回的分支，不再等下一次读取。 */
export type DraftBranches = {
  /** undefined 表示正在首次读取，null 表示没有可用的 Git 仓库。 */
  branches: WorkbenchBranches | null | undefined
  failed: boolean
  refresh: () => Promise<void>
  accept: (next: WorkbenchBranches | null) => void
}

/** root 为 null 时不读取；目录换了以后旧目录迟到的结果被丢弃。 */
export function useDraftBranches(
  bridge: WorkbenchBridge | undefined,
  root: string | null,
): DraftBranches {
  const [branches, setBranches] = useState<WorkbenchBranches | null>()
  const [failed, setFailed] = useState(false)
  const request = useRef(0)
  const lastRead = useRef(0)
  const refresh = useCallback(async () => {
    if (!bridge || !root) return
    const id = ++request.current
    try {
      const next = await bridge.branches(root)
      if (id !== request.current) return
      lastRead.current = Date.now()
      setBranches(next)
      setFailed(false)
    } catch {
      if (id === request.current) setFailed(true)
    }
  }, [bridge, root])

  useEffect(() => {
    setBranches(undefined)
    setFailed(false)
    if (!bridge || !root) return
    const reload = () => void refresh()
    reload()
    window.addEventListener("focus", reload)
    const timer = window.setInterval(() => {
      if (document.hasFocus() && Date.now() - lastRead.current >= 3_000) reload()
    }, 3_000)
    return () => {
      request.current += 1
      window.removeEventListener("focus", reload)
      window.clearInterval(timer)
    }
  }, [bridge, root, refresh])

  const accept = useCallback((next: WorkbenchBranches | null) => {
    request.current += 1
    lastRead.current = Date.now()
    setBranches(next)
    setFailed(false)
  }, [])

  return { branches, failed, refresh, accept }
}
