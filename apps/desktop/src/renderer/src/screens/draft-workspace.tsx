// 负责新会话草稿的分支与 worktree：读当前分支，切换或新建分支，记下是否在新 worktree 里开始；
// 发送时按需新建 worktree，交出会话要用的目录。新建失败时在输入框下说明原因，文字留在草稿里。
import { useEffect, useState, type ReactNode } from "react"
import { useLocale } from "@pigclaude/ui-primitives"
import { useToast } from "@pigclaude/ui-shell"
import type { WorkbenchBridge } from "../../../workbench-contract"
import { useDraftBranches } from "../hooks/use-draft-branches"
import { useText } from "../locale/text"
import { workbenchError } from "../workbench/workbench-errors"
import { DraftWorkspaceControls, type DraftWorktree } from "./draft-workspace-controls"

/** 草稿页要画的控件和状态，以及发送时取会话目录的入口。 */
export type DraftWorkspace = {
  controls: ReactNode
  status: ReactNode
  /** 正在切分支、正在建 worktree，或 worktree 还没有起点时为 true，此时不能发送。 */
  busy: boolean
  /** 打开了 worktree 开关时从 target 新建 worktree 并返回它的目录，否则原样返回 target；失败时为 null。 */
  start: (target: string) => Promise<string | null>
}

/** root 是草稿所在的目录，为 null（没有项目或不在草稿页）时不读分支、不画控件。 */
export function useDraftWorkspace(
  bridge: WorkbenchBridge | undefined,
  root: string | null,
): DraftWorkspace {
  const { t } = useText()
  const locale = useLocale()
  const toast = useToast()
  const git = useDraftBranches(bridge, root)
  const [worktree, setWorktree] = useState<DraftWorktree | null>(null)
  const [switching, setSwitching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    setWorktree(null)
    setFailure(null)
  }, [root])

  async function changeBranch(branch: string, create: boolean): Promise<void> {
    if (!bridge || !root) return
    setSwitching(true)
    try {
      git.accept(await bridge.switchBranch(root, branch, create))
    } catch (error: unknown) {
      void git.refresh()
      throw new Error(workbenchError(error, t))
    } finally {
      setSwitching(false)
    }
  }

  async function start(target: string): Promise<string | null> {
    if (!worktree || !bridge) return target
    setCreating(true)
    setFailure(null)
    try {
      return (await bridge.createWorktree(target, worktree.baseRef)).path
    } catch (error: unknown) {
      setFailure(workbenchError(error, t))
      return null
    } finally {
      setCreating(false)
    }
  }

  const needsBase = worktree !== null && !worktree.baseRef && !git.branches?.head
  const unavailableReason = git.failed
    ? locale.t("newThread.branch.loadFailed")
    : git.branches === undefined
      ? t("workbench.worktreeChecking")
      : t("workbench.worktreeRequiresRepository")
  const controls =
    bridge && root ? (
      <DraftWorkspaceControls
        branches={git.branches ?? null}
        unavailableReason={unavailableReason}
        worktree={worktree}
        disabled={switching || creating}
        onOpenBranches={() => void git.refresh()}
        onSwitchBranch={(branch) =>
          void changeBranch(branch, false).catch((error: unknown) =>
            toast(error instanceof Error ? error.message : t("workbench.branchFailed"), "alert"),
          )
        }
        onWorktree={(next) => {
          setWorktree(next)
          setFailure(null)
        }}
        onCreateBranch={(branch) => changeBranch(branch, true)}
      />
    ) : null
  const status = creating ? (
    <p className="draft-workspace-status" role="status">
      {locale.t("newThread.worktree.creating")}
    </p>
  ) : failure ? (
    <div className="draft-workspace-status error-text" role="alert">
      <span>{locale.t("newThread.worktree.failed")}</span>
      <span>{failure}</span>
    </div>
  ) : git.failed && !git.branches ? (
    <p className="draft-workspace-status hint">{locale.t("newThread.branch.loadFailed")}</p>
  ) : null

  return { controls, status, busy: switching || creating || needsBase, start }
}
