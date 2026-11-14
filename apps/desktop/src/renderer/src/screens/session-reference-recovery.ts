// 续接失败后为已有会话寻找可用的草稿项目，并按草稿键投递引用。

import type { SessionReference } from "../../../main/session/session-types"
import type { SavedSessionSummary } from "../models/saved-session"

type Recovery = {
  projects: readonly string[]
  isCurrent: () => boolean
  pickWorkspace: () => Promise<string | null>
  openDraft: (project: string, atProjectRoot?: boolean) => string | null
  queue: (key: string, reference: SessionReference) => void
  untitled: string
}

/** 按可读的项目目录打开新草稿；等待选择期间离开旧会话时保留用户所在页面。 */
export async function openSessionReferenceDraft(
  summary: SavedSessionSummary,
  workspaceMissing: boolean,
  recovery: Recovery,
): Promise<void> {
  const original = summary.projectPath ?? summary.workspace
  let project: string | null = original
  if (workspaceMissing || !recovery.projects.includes(original)) {
    const recent = await window.pigclaude?.workspaces?.available?.()
    const available = recent ?? recovery.projects.filter((path) => path !== summary.workspace)
    if (!recovery.isCurrent()) return
    project = available.includes(original)
      ? original
      : (available[0] ?? (await recovery.pickWorkspace()))
  }
  if (project === null || !recovery.isCurrent()) return
  const key = recovery.openDraft(project, workspaceMissing)
  if (key !== null) {
    recovery.queue(key, {
      kind: "thread",
      threadId: summary.sessionId,
      title: summary.title ?? recovery.untitled,
    })
  }
}
