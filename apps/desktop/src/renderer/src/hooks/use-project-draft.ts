// 负责一个窗口中的项目草稿：分别保留每个项目的账号、模型、权限和启动结果。

import { useCallback, useState } from "react"
import type { RuntimeMode } from "@pigclaude/ui-contracts"

/** 每个项目的草稿选项与当前启动状态。未选的项由聊天页取最近的默认设置。 */
export type ProjectDraft = {
  accountId?: string
  modelId?: string
  level?: RuntimeMode
  plan?: boolean
  pending?: boolean
  error?: string | null
}

/** 当前草稿以及只修改这个项目的入口。 */
export type ProjectDraftEditor = {
  draft: ProjectDraft
  update: (patch: ProjectDraft) => void
}

const blank: ProjectDraft = {}

/** 草稿随窗口保持，切换到其他项目或页面时不会覆盖已有的选择。 */
export function useProjectDraft(projectId: string | null): ProjectDraftEditor {
  const [drafts, setDrafts] = useState<ReadonlyMap<string | null, ProjectDraft>>(new Map())
  const update = useCallback(
    (patch: ProjectDraft) => {
      setDrafts((current) =>
        new Map(current).set(projectId, { ...current.get(projectId), ...patch }),
      )
    },
    [projectId],
  )
  return {
    draft: drafts.get(projectId) ?? blank,
    update,
  }
}
