// 负责会话历史设置的主进程请求、归档列表和确认后的删除操作。

import { useCallback, useEffect, useRef, useState } from "react"
import type { SessionHistoryStats, SessionRetention } from "../../../session-history-contract"
import type { SavedSessionSummary } from "../models/saved-session"
import { sessionErrorFrom } from "./use-session"
import { useSessionWorkspaces } from "./use-session-workspaces"

/** 需要用户确认的删除目标；all 指当前存储的全部会话。 */
export type HistoryDeletion = { kind: "one"; session: SavedSessionSummary } | { kind: "all" }

type HistoryOptions = {
  page: string | null
  summaries: readonly SavedSessionSummary[]
  report: (message: string) => void
  onSessionsDeleted: (projects: ReadonlyMap<string, string>) => void
  refreshActive: () => Promise<void>
}

/** 连接桌面桥；预览和旧桥没有管理命令时保留原有会话视图。 */
export function useSessionHistory({
  page,
  summaries,
  report,
  onSessionsDeleted,
  refreshActive,
}: HistoryOptions) {
  const bridge = window.pigclaude?.session
  const enabled = bridge?.rename !== undefined && bridge.archive !== undefined
  const local = useSessionWorkspaces(summaries)
  const [archived, setArchived] = useState<readonly SavedSessionSummary[]>([])
  const [stats, setStats] = useState<SessionHistoryStats | null>(null)
  const [retention, setRetention] = useState<SessionRetention | null>(null)
  const [deletion, setDeletion] = useState<HistoryDeletion | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [deleted, setDeleted] = useState<ReadonlyMap<string, string>>(new Map())
  const mutate = useRef(false)
  const archivedRevision = useRef(0)
  const archivedRefresh = page === "archived" ? summaries : null

  const readArchived = useCallback(async () => {
    const request = ++archivedRevision.current
    const value = await bridge?.list({ archived: true })
    if (value && request === archivedRevision.current) setArchived(value)
  }, [bridge])

  useEffect(() => {
    if (!enabled || !bridge) return
    let current = true
    const load =
      page === "archived"
        ? readArchived()
        : page === "data"
          ? bridge.dataStats?.().then((value) => {
              if (current) setStats(value)
            })
          : page === "session"
            ? bridge.retention?.().then((value) => {
                if (current) setRetention(value)
              })
            : undefined
    setLoadError(null)
    setLoading(load !== undefined)
    void load
      ?.catch((reason: unknown) => {
        if (current) setLoadError(sessionErrorFrom(reason))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [archivedRefresh, bridge, enabled, page, readArchived, refresh])

  const rename = useCallback(
    (sessionId: string, title: string) => {
      void bridge
        ?.rename?.({ sessionId, title })
        .then(refreshActive)
        .catch((reason: unknown) => report(sessionErrorFrom(reason)))
    },
    [bridge, refreshActive, report],
  )

  async function archive(sessionId: string, next: boolean): Promise<void> {
    if (!bridge?.archive) return
    try {
      await bridge.archive({ sessionId, archived: next })
      ++archivedRevision.current
      if (next) {
        const summary = summaries.find((item) => item.sessionId === sessionId)
        if (summary)
          setArchived((current) => [
            ...current.filter((item) => item.sessionId !== sessionId),
            summary,
          ])
      } else {
        setArchived((current) => current.filter((item) => item.sessionId !== sessionId))
      }
      await Promise.all([refreshActive(), readArchived()])
    } catch (reason) {
      report(sessionErrorFrom(reason))
    }
  }

  async function confirmDeletion(): Promise<void> {
    if (deletion === null || mutate.current || !bridge) return
    const action =
      deletion.kind === "all"
        ? bridge.clearHistory?.bind(bridge)
        : bridge.delete?.bind(bridge, { sessionId: deletion.session.sessionId })
    if (!action) return
    mutate.current = true
    setDeleting(true)
    setDeleteError(null)
    try {
      await action()
      const targets = deletion.kind === "all" ? [...summaries, ...archived] : [deletion.session]
      const projects = new Map(
        targets.map((item) => [item.sessionId, item.projectPath ?? item.workspace] as const),
      )
      ++archivedRevision.current
      setDeleted((current) => new Map([...current, ...projects]))
      local.remove(deletion.kind === "all" ? undefined : deletion.session.sessionId)
      onSessionsDeleted(projects)
      setArchived((current) =>
        deletion.kind === "all"
          ? []
          : current.filter((item) => item.sessionId !== deletion.session.sessionId),
      )
      setDeletion(null)
    } catch (reason) {
      setDeleteError(sessionErrorFrom(reason))
    } finally {
      setRefresh((value) => value + 1)
      mutate.current = false
      setDeleting(false)
      void refreshActive()
    }
  }

  function promptDeletion(value: HistoryDeletion | null): void {
    if (mutate.current) return
    setDeleteError(null)
    setDeletion(value)
  }

  async function saveRetention(days: number | null): Promise<void> {
    if (saving || !bridge?.setRetention) return
    setSaving(true)
    try {
      setRetention(await bridge.setRetention({ days }))
    } catch (reason) {
      report(sessionErrorFrom(reason))
    } finally {
      setSaving(false)
    }
  }

  return {
    enabled,
    rename,
    archive,
    archived,
    workspaces: local.workspaces,
    rememberWorkspace: local.remember,
    hidden: new Set([...deleted.keys(), ...archived.map((item) => item.sessionId)]),
    canDelete: bridge?.delete !== undefined,
    canClear: bridge?.clearHistory !== undefined,
    stats,
    retention,
    saveRetention,
    saving,
    loadError,
    deleteError,
    loading,
    deletion,
    deleting,
    promptDeletion,
    confirmDeletion,
    deleted,
  }
}

/** 供设置页和窗口共同使用的会话历史控制器。 */
export type SessionHistoryController = ReturnType<typeof useSessionHistory>
