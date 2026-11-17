// 提供工作台适配层的错误、刷新与工作区选择文案。
/** 工作台适配层的简体中文文案。 */
export const workbenchZhCN = {
  "workbench.addProjectFirst": "请先选择项目目录",
  "workbench.unavailable": "工作台暂不可用",
  "workbench.operationFailed": "工作台操作失败，请重试",
  "workbench.notGit": "当前项目不是 Git 仓库",
  "workbench.largeDiff": "改动太多，打开单个文件查看 Diff",
  "workbench.fileChanged": "磁盘上的文件已变更",
  "workbench.projectTrustRequired": "启用项目设置与 MCP 后，此文件会从下一次会话开始生效。",
  "workbench.terminalFailed": "无法打开终端",
  "workbench.terminalExited": "终端已退出（{code}）",
  "workbench.browserContext": "网页元素",
  "workbench.browserActivity.navigate": "跳转",
  "workbench.browserActivity.click": "点击",
  "workbench.browserActivity.type": "输入",
  "workbench.refresh": "刷新",
  "workbench.discardDraft": "放弃这个文件的未保存改动？",
  "workbench.discardDrafts": "放弃这些文件的未保存改动？{files}",
  "workbench.unsavedSaveFailed": "{files} 没能保存，请处理后再试。",
  "workbench.discardProjectDrafts": "切换项目会放弃工作台里的未保存改动。继续吗？",
  "workbench.rootDirectory": "返回项目根目录",
  "workbench.turnActive": "请等当前回复结束后再恢复检查点",
  "workbench.branchConflict": "切换会覆盖未提交的改动，没有切换。先提交或暂存这些改动再试。",
  "workbench.branchExists": "已经有同名的分支。",
  "workbench.branchInvalid": "分支名不合法。",
  "workbench.branchFailed": "切换分支失败。",
  "workbench.worktreeChecking": "正在检查 Git 仓库…",
  "workbench.worktreeRequiresRepository": "请添加并选择一个 Git 仓库来使用 worktree。",
  "workbench.worktreeBaseInvalid": "worktree 的起点无效，请重新选择分支。",
  "workbench.worktreeIncludeTooLarge":
    ".worktreeinclude 匹配的文件超过 5,000 个，没有创建 worktree。",
} as const

/** 工作台适配层的英文文案。 */
export const workbenchEnUS: Record<keyof typeof workbenchZhCN, string> = {
  "workbench.addProjectFirst": "Choose a project folder first",
  "workbench.unavailable": "Workbench unavailable",
  "workbench.operationFailed": "Workbench operation failed. Try again.",
  "workbench.notGit": "This project is not a Git repository",
  "workbench.largeDiff": "This diff is too large. View changes for an individual file.",
  "workbench.fileChanged": "The file changed on disk",
  "workbench.projectTrustRequired":
    "Enable project settings and MCP to apply this file in new and resumed sessions.",
  "workbench.terminalFailed": "Could not open terminal",
  "workbench.terminalExited": "Terminal exited ({code})",
  "workbench.browserContext": "Page element",
  "workbench.browserActivity.navigate": "Navigate",
  "workbench.browserActivity.click": "Click",
  "workbench.browserActivity.type": "Type",
  "workbench.refresh": "Refresh",
  "workbench.discardDraft": "Discard unsaved changes to this file?",
  "workbench.discardDrafts": "Discard unsaved changes to these files? {files}",
  "workbench.unsavedSaveFailed": "Could not save {files}. Resolve it and try again.",
  "workbench.discardProjectDrafts": "Switch projects and discard unsaved Workbench changes?",
  "workbench.rootDirectory": "Return to project root",
  "workbench.turnActive": "Wait for the current response to finish before restoring a checkpoint",
  "workbench.branchConflict":
    "Switching would overwrite uncommitted changes, so the branch was not switched. Commit or stash them and try again.",
  "workbench.branchExists": "A branch with this name already exists.",
  "workbench.branchInvalid": "This branch name is not valid.",
  "workbench.branchFailed": "Could not switch branches.",
  "workbench.worktreeChecking": "Checking the Git repository…",
  "workbench.worktreeRequiresRepository": "Add and select a Git repository to use a worktree.",
  "workbench.worktreeBaseInvalid":
    "The starting point for the worktree is not valid. Choose a branch again.",
  "workbench.worktreeIncludeTooLarge":
    ".worktreeinclude matches more than 5,000 files, so no worktree was created.",
}
