// 定时任务只选择每次新建 worktree 的起点，沿用新会话里的分支选择器。

import { useLocale } from "@pigclaude/ui-primitives"
import type { ScheduleWorkspaceControlsProps } from "@pigclaude/ui-settings"
import { useDraftBranches } from "../hooks/use-draft-branches"
import { useText } from "../locale/text"
import { DraftWorkspaceControls } from "./draft-workspace-controls"

/** 隔离运行选项跟随编辑中的项目；普通目录显示置灰开关。 */
export function ScheduleWorkspaceControls({
  projectId,
  worktree,
  onWorktree,
  disabled,
}: ScheduleWorkspaceControlsProps) {
  const { t } = useText()
  const locale = useLocale()
  const git = useDraftBranches(window.pigclaude?.workbench, projectId)
  const reason = git.failed
    ? locale.t("newThread.branch.loadFailed")
    : git.branches === undefined
      ? t("workbench.worktreeChecking")
      : t("workbench.worktreeRequiresRepository")
  return (
    <DraftWorkspaceControls
      branches={git.branches ?? null}
      unavailableReason={reason}
      worktreeHint={t("scheduledTasks.worktreeHint")}
      worktree={worktree ?? null}
      disabled={disabled}
      onOpenBranches={() => void git.refresh()}
      onWorktree={onWorktree}
    />
  )
}
