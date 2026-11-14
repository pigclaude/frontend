// 把已保存的会话摘要转成 Pigcode @ 菜单需要的选项。

import type { ComposerThreadOption } from "@pigclaude/ui-composer"
import { projectNameFromPath } from "./project-model"
import type { SavedSessionSummary } from "./saved-session"

type Sources = {
  summaries: readonly SavedSessionSummary[]
  archived: readonly SavedSessionSummary[]
  deleted: ReadonlyMap<string, string>
  current: string | null
  project: string | null
  names: Readonly<Record<string, string>>
  untitled: string
}

/** 按最近活动排序，供输入框筛选其他会话，包含已归档的会话。 */
export function composerSessionOptions(sources: Sources): ComposerThreadOption[] {
  const options = new Map<string, SavedSessionSummary>()
  for (const summary of [...sources.summaries, ...sources.archived]) {
    if (
      summary.restorable &&
      summary.sessionId !== sources.current &&
      !sources.deleted.has(summary.sessionId)
    ) {
      options.set(summary.sessionId, summary)
    }
  }
  const archived = new Set(sources.archived.map(({ sessionId }) => sessionId))
  return [...options.values()]
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
    .map(({ sessionId, title, workspace, projectPath, archivedAt }) => {
      const project = projectPath ?? workspace
      return {
        id: sessionId,
        title: title ?? sources.untitled,
        projectName: sources.names[project] ?? projectNameFromPath(project),
        sameProject: project === sources.project,
        archived: archivedAt != null || archived.has(sessionId),
      }
    })
}
