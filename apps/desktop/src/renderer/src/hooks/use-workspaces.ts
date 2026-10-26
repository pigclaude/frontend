// 负责加载最近工作区、选择文件夹并写回 <userData>/workspaces.json；页面只拿到路径列表。

import { useCallback, useEffect, useState } from "react"
import { sessionErrorText } from "../models/session-model"

/** preload 暴露的最近工作区命令；测试可注入假实现。 */
export type WorkspacesBridge = {
  list: () => Promise<string[]>
  add: (path: string) => Promise<string[]>
}

/** 最近工作区控制器。 */
export type WorkspacesController = {
  paths: string[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (path: string) => Promise<void>
  pick: () => Promise<string | null>
}

/** 读取最近工作区；没有桌面桥时返回空列表并给出可读错误。 */
export function useWorkspaces(
  bridge?: WorkspacesBridge | null,
  pickFolder?: (() => Promise<string | null>) | null,
): WorkspacesController {
  const resolved = bridge === undefined ? window.pigclaude?.workspaces : bridge
  const resolvedPick = pickFolder === undefined ? window.pigclaude?.pickFolder : pickFolder
  const [paths, setPaths] = useState<string[]>([])
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

  return { paths, loading, error, refresh, add, pick }
}
