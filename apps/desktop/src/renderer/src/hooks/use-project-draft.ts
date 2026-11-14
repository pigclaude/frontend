// 负责一个窗口中的项目草稿：分别保留每个项目的账号、模型、权限和启动结果。

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import type { RuntimeMode } from "@pigclaude/ui-contracts"
import type { MembershipView } from "@pigclaude/contracts/membership"

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
  /** 与会员代次绑定的输入框键。 */
  key: string
  /** 异步启动期间会员仍是原来那一代。 */
  isCurrent: () => boolean
  update: (patch: ProjectDraft) => void
}

/** DesktopGate 维护的项目草稿，跨主窗口挂载保留。 */
export type ProjectDrafts = {
  forProject: (projectId: string | null) => ProjectDraftEditor
  clear: () => void
}

const blank: ProjectDraft = {}

type DraftWindow = {
  owner: string
  generation: string
  drafts: ReadonlyMap<string | null, ProjectDraft>
}

function blankWindow(owner: string, generation: string): DraftWindow {
  return { owner, generation, drafts: new Map() }
}

/** 草稿跟随同一份本机会员会话。短暂无法核验时保留草稿，退出或身份变更时撤销旧草稿。 */
export function useProjectDrafts(
  membership: MembershipView,
  browserPreview: boolean,
): ProjectDrafts {
  const [stored, setWindow] = useState(() => blankWindow("signed-out", crypto.randomUUID()))
  const userId = membership.account?.userId
  const terminal = membership.state === "signed_out" || membership.state === "device_revoked"
  const owner = browserPreview
    ? "preview"
    : terminal
      ? "signed-out"
      : membership.state === "active" && userId
        ? JSON.stringify([userId, membership.bindingEpoch, membership.actionContextId])
        : stored.owner
  const current = useRef(stored.generation)
  // 同一渲染里先切换到空草稿，避免新会员看到上一代的输入或选项。
  const draftsWindow = stored.owner === owner ? stored : blankWindow(owner, crypto.randomUUID())
  if (draftsWindow !== stored) setWindow(draftsWindow)
  useLayoutEffect(() => {
    current.current = draftsWindow.generation
    return () => {
      current.current = ""
    }
  }, [draftsWindow.generation])

  const clear = useCallback(() => {
    const next = blankWindow(owner, crypto.randomUUID())
    current.current = next.generation
    setWindow(next)
  }, [owner])
  return {
    clear,
    forProject(projectId) {
      const { generation, drafts } = draftsWindow
      const isCurrent = () => current.current === generation
      return {
        draft: drafts.get(projectId) ?? blank,
        key: JSON.stringify(["project-draft", generation, projectId]),
        isCurrent,
        update(patch) {
          if (!isCurrent()) return
          setWindow((window) =>
            window.generation === generation
              ? {
                  ...window,
                  drafts: new Map(window.drafts).set(projectId, {
                    ...window.drafts.get(projectId),
                    ...patch,
                  }),
                }
              : window,
          )
        },
      }
    },
  }
}
