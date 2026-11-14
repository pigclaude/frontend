// 负责加载最近工作区、选择文件夹并写回 <userData>/workspaces.json，以及侧栏项目的显示名和移除；
// 页面只拿到路径列表和显示名。

import { useCallback, useEffect, useState } from "react"
import { sessionErrorText } from "../models/session-model"

/** preload 暴露的最近工作区命令；测试可注入假实现。 */
export type WorkspacesBridge = {
  list: () => Promise<string[]>
  add: (path: string) => Promise<string[]>
  names: () => Promise<Record<string, string>>
  rename: (path: string, name: string) => Promise<Record<string, string>>
  remove: (path: string) => Promise<string[]>
}

/** 最近工作区控制器。 */
export type WorkspacesController = {
  paths: string[]
  /** 改过名的项目的侧栏显示名，按路径。 */
  names: Record<string, string>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (path: string) => Promise<void>
  pick: () => Promise<string | null>
  /** 只改侧栏显示名；失败时抛出，显示名不变。 */
  rename: (path: string, name: string) => Promise<void>
  /** 从侧栏移除项目，不删文件；失败时抛出，列表不变。 */
  remove: (path: string) => Promise<void>
}

/** 读取最近工作区；没有桌面桥时返回空列表并给出可读错误。 */
export function useWorkspaces(
  bridge?: WorkspacesBridge | null,
  pickFolder?: (() => Promise<string | null>) | null,
): WorkspacesController {
  const resolved = bridge === undefined ? window.pigclaude?.workspaces : bridge
  const resolvedPick = pickFolder === undefined ? window.pigclaude?.pickFolder : pickFolder
  const [paths, setPaths] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (resolved === null || resolved === undefined) {
      setLoading(false)
      setError("最近工作区不可用")
      return
    }
    try {
      setPaths(await resolved.list())
      setNames(await resolved.names().catch(() => ({})))
      setError(null)
    } catch {
      setError("最近工作区读取失败")
    } finally {
      setLoading(false)
    }
  }, [resolved])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const add = useCallback(
    async (path: string): Promise<void> => {
      if (resolved === null || resolved === undefined) {
        setError("最近工作区不可用")
        throw new Error("最近工作区不可用")
      }
      try {
        setPaths(await resolved.add(path))
        setError(null)
      } catch (caught: unknown) {
        const message = sessionErrorText(
          caught instanceof Error ? caught.message : "工作区必须是已存在的绝对目录",
        )
        setError(message)
        throw new Error(message)
      }
    },
    [resolved],
  )

  const pick = useCallback(async (): Promise<string | null> => {
    if (resolvedPick === null || resolvedPick === undefined) return null
    const path = await resolvedPick()
    if (path === null) return null
    await add(path)
    return path
  }, [add, resolvedPick])

  const rename = useCallback(
    async (path: string, name: string): Promise<void> => {
      if (resolved === null || resolved === undefined) throw new Error("最近工作区不可用")
      setNames(await resolved.rename(path, name))
    },
    [resolved],
  )

  const remove = useCallback(
    async (path: string): Promise<void> => {
      if (resolved === null || resolved === undefined) throw new Error("最近工作区不可用")
      setPaths(await resolved.remove(path))
      setNames((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== path)),
      )
    },
    [resolved],
  )

  return { paths, names, loading, error, refresh, add, pick, rename, remove }
}
