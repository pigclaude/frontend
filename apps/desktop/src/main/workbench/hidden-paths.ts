// 负责工作台的路径隐藏规则：哪些目录不能经工作台读写、比较和恢复，哪些目录不在文件树里列出。
// 文件树、文件读写、Diff 和检查点都从这里取规则。

const privatePath = /(?:^|\/)(?:\.git|\.claude\/worktrees)(?:\/|$)/i
const claudePath = /(?:^|\/)\.claude(?:\/|$)/i
const UNLISTED_NAMES = ["node_modules", ".superpowers"]

/** 旧检查点恢复沿用原来的快照范围，当前工作台允许访问项目配置。 */
export type WorkbenchPathScope = "workspace" | "legacy-checkpoint"

/** 项目内相对路径是否经过版本库内部或 Claude Code 的 worktree 目录；不区分大小写。 */
export function protectedWorkbenchPath(
  path: string,
  scope: WorkbenchPathScope = "workspace",
): boolean {
  return privatePath.test(path) || (scope === "legacy-checkpoint" && claudePath.test(path))
}

/** 文件树是否列出这个目录项；不能访问的目录和依赖、工具缓存目录都不列出。 */
export function listedWorkbenchEntry(directory: string, name: string): boolean {
  const path = directory ? directory + "/" + name : name
  return !protectedWorkbenchPath(path) && !UNLISTED_NAMES.includes(name)
}

/** Git 路径规则只匹配项目文件，排除各层 Claude Code 的 worktree；受保护的路径直接拒绝。 */
export function workbenchPathspec(path = ".", scope: WorkbenchPathScope = "workspace"): string[] {
  if (protectedWorkbenchPath(path, scope)) throw new Error("WORKBENCH_PATH_INVALID")
  const excluded =
    scope === "legacy-checkpoint"
      ? [":(exclude,icase,glob)**/.claude", ":(exclude,icase,glob)**/.claude/**"]
      : [
          ":(exclude,icase,glob)**/.claude/worktrees",
          ":(exclude,icase,glob)**/.claude/worktrees/**",
        ]
  return [path === "." ? "." : ":(literal)" + path, ...excluded]
}
