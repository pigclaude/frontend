// 负责暂时记住本窗口新建会话的工作目录，等主进程的列表接替这份记录。

import { useEffect, useState } from "react"
import type { SavedSessionSummary } from "../models/saved-session"

/** 主进程第一次返回该会话后移除回退，后续归档或清理不会让旧行重新出现。 */
export function useSessionWorkspaces(
  summaries: readonly SavedSessionSummary[],
  removed: ReadonlyMap<string, string>,
) {
  const [workspaces, setWorkspaces] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    const confirmed = new Set(summaries.map((summary) => summary.sessionId))
    const stale = [...workspaces.keys()].filter((id) => confirmed.has(id) || removed.has(id))
    if (stale.length === 0) return
    setWorkspaces((current) => {
      const next = new Map(current)
      for (const id of stale) next.delete(id)
      return next
    })
  }, [removed, summaries, workspaces])
  return {
    workspaces,
    remember: (id: string, path: string) =>
      setWorkspaces((current) => new Map(current).set(id, path)),
    remove: (sessionId?: string) => {
      setWorkspaces((current) => {
        if (sessionId === undefined) return new Map()
        const next = new Map(current)
        next.delete(sessionId)
        return next
      })
    },
  }
}
