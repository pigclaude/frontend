// 续接失败后为已有会话寻找可用的草稿项目，并按草稿键投递引用。

import { useLayoutEffect, useRef } from "react"
import type { SessionReference } from "../../../main/session/session-types"
import type { SavedSessionSummary } from "../models/saved-session"

type Recovery = {
  projects: readonly string[]
  pickWorkspace: () => Promise<string | null>
  openDraft: (project: string, atProjectRoot?: boolean) => string | null
  queue: (key: string, reference: SessionReference) => void
  untitled: string
  report: (error: unknown) => void
}

/** 按可读的项目目录打开含引用的新草稿；离开旧会话或卸载窗口后丢弃迟到的选择。 */
export function useSessionReferenceRecovery(sessionId: string | null, recovery: Recovery) {
  const generation = useRef<symbol | null>(null)
  useLayoutEffect(() => {
    generation.current = Symbol()
    return () => {
      generation.current = null
    }
  }, [sessionId])
  return async (summary: SavedSessionSummary, missing: boolean): Promise<void> => {
    const started = generation.current
    const isCurrent = () =>
      started !== null && started === generation.current && sessionId === summary.sessionId
    try {
      await openSessionReferenceDraft(summary, missing, recovery, isCurrent)
    } catch (error) {
      if (isCurrent()) recovery.report(error)
    }
  }
}

async function openSessionReferenceDraft(
  summary: SavedSessionSummary,
  workspaceMissing: boolean,
  recovery: Recovery,
  isCurrent: () => boolean,
): Promise<void> {
  const original = summary.projectPath ?? summary.workspace
  const recent = await window.pigclaude?.workspaces?.available?.()
  const available =
    recent ?? recovery.projects.filter((path) => !workspaceMissing || path !== summary.workspace)
  if (!isCurrent()) return
  const project = available.includes(original)
    ? original
    : (available[0] ?? (await recovery.pickWorkspace()))
  if (project === null || !isCurrent()) return
  const key = recovery.openDraft(project, true)
  if (key !== null) {
    recovery.queue(key, {
      kind: "thread",
      threadId: summary.sessionId,
      title: summary.title ?? recovery.untitled,
    })
  }
}
