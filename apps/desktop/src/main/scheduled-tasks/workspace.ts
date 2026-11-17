// 为选择了 worktree 的定时任务准备本次运行目录，尚未留下会话的运行清理空工作树。

import type { ScheduledTaskInput, ScheduledTaskOutcome } from "../../scheduled-tasks-contract"
import type { WorkbenchWorktree } from "../../workbench-contract"
import { runWorkbenchGit } from "../workbench/git-command"
import { createWorkbenchWorktree, removeWorkbenchWorktree } from "../workbench/git-workspace"
import type { WorktreeRegistry } from "../workbench/worktree-registry"
import type { ScheduledTaskRunnerPorts } from "./runner"

const stopped: ScheduledTaskOutcome = { status: "stopped", reason: "APP_STOPPED" }

/** 前置检查完成后进入原项目，或创建并登记一个属于该项目的独立工作树。 */
export async function runScheduledWorkspace(
  task: ScheduledTaskInput,
  signal: AbortSignal,
  registry: Pick<WorktreeRegistry, "remember" | "forget">,
  launch: ScheduledTaskRunnerPorts["runSession"],
): Promise<ScheduledTaskOutcome> {
  if (signal.aborted) return stopped
  if (!task.worktree) return launch(task, signal)
  let worktree: WorkbenchWorktree | undefined
  let hasSession = false
  try {
    worktree = await createWorkbenchWorktree(task.projectPath, task.worktree.baseRef)
    if (signal.aborted) {
      await discard(task.projectPath, worktree, registry)
      return stopped
    }
    await registry.remember(worktree.path, task.projectPath)
  } catch {
    if (worktree) await discard(task.projectPath, worktree, registry)
    return signal.aborted ? stopped : { status: "failed", reason: "SCHEDULE_WORKTREE_FAILED" }
  }
  try {
    const outcome = signal.aborted ? stopped : await launch(task, signal, worktree.path)
    hasSession = Boolean(outcome.sessionId)
    return outcome
  } finally {
    if (!hasSession) await discard(task.projectPath, worktree, registry)
  }
}

async function discard(
  projectPath: string,
  worktree: WorkbenchWorktree,
  registry: Pick<WorktreeRegistry, "forget">,
): Promise<void> {
  try {
    // Git 会拒绝移除有改动的工作树，此时保留目录与分支。
    await removeWorkbenchWorktree(projectPath, worktree.path)
    await registry.forget(worktree.path).catch(() => undefined)
    if (worktree.branch) await runWorkbenchGit(projectPath, ["branch", "-D", worktree.branch])
  } catch {
    // 保留原本的任务结果。
  }
}
