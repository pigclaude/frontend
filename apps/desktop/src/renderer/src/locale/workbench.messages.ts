// 提供工作台适配层的错误、刷新与工作区选择文案。
/** 工作台适配层的简体中文文案。 */
export const workbenchZhCN = {
  "workbench.addProjectFirst": "请先选择项目目录",
  "workbench.unavailable": "工作台暂不可用",
  "workbench.operationFailed": "工作台操作失败，请重试",
  "workbench.notGit": "当前项目不是 Git 仓库",
  "workbench.largeDiff": "改动太多，打开单个文件查看 Diff",
  "workbench.fileChanged": "磁盘上的文件已变更",
  "workbench.terminalFailed": "无法打开终端",
  "workbench.terminalExited": "终端已退出（{code}）",
  "workbench.browserContext": "网页元素",
  "workbench.refresh": "刷新",
  "workbench.discardDraft": "放弃这个文件的未保存改动？",
  "workbench.discardDrafts": "放弃这些文件的未保存改动？{files}",
  "workbench.discardProjectDrafts": "切换项目会放弃工作台里的未保存改动。继续吗？",
  "workbench.rootDirectory": "返回项目根目录",
  "workbench.turnActive": "请等当前回复结束后再恢复检查点",
} as const

/** 工作台适配层的英文文案。 */
export const workbenchEnUS: Record<keyof typeof workbenchZhCN, string> = {
  "workbench.addProjectFirst": "Choose a project folder first",
  "workbench.unavailable": "Workbench unavailable",
  "workbench.operationFailed": "Workbench operation failed. Try again.",
  "workbench.notGit": "This project is not a Git repository",
  "workbench.largeDiff": "This diff is too large. View changes for an individual file.",
  "workbench.fileChanged": "The file changed on disk",
  "workbench.terminalFailed": "Could not open terminal",
  "workbench.terminalExited": "Terminal exited ({code})",
  "workbench.browserContext": "Page element",
  "workbench.refresh": "Refresh",
  "workbench.discardDraft": "Discard unsaved changes to this file?",
  "workbench.discardDrafts": "Discard unsaved changes to these files? {files}",
  "workbench.discardProjectDrafts": "Switch projects and discard unsaved Workbench changes?",
  "workbench.rootDirectory": "Return to project root",
  "workbench.turnActive": "Wait for the current response to finish before restoring a checkpoint",
}
