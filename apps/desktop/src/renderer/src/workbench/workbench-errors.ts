// 将主进程工作台错误码映射到当前语言，避免把 IPC 堆栈展示给用户。
import type { TextKey } from "../locale/text"

/** 返回用户可以处理的工作台提示；未知 IPC 错误使用通用提示。 */
export function workbenchError(error: unknown, t: (key: TextKey) => string): string {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("WORKBENCH_NOT_GIT")) return t("workbench.notGit")
  if (message.includes("WORKBENCH_PROJECT_REQUIRED")) return t("workbench.addProjectFirst")
  if (message.includes("WORKBENCH_DIFF_TOO_LARGE")) return t("workbench.largeDiff")
  if (message.includes("WORKBENCH_FILE_CHANGED")) return t("workbench.fileChanged")
  if (message.includes("WORKBENCH_TURN_ACTIVE")) return t("workbench.turnActive")
  if (message.includes("WORKBENCH_TERMINAL_FAILED")) return t("workbench.terminalFailed")
  return t("workbench.operationFailed")
}
