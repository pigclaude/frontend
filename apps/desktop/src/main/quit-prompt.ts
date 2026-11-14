// 负责退出流程里的系统对话框：有工作进行时确认是否离开，以及资源没能关闭时的提示。
import { dialog, type BrowserWindow } from "electron"
import type { LeaveAction } from "./quit-confirmation"
import type { SessionPendingWork } from "./session/session-host-support"

/** 问用户是否中断工作离开；选「退出」或「关闭窗口」时得到 true，默认按钮是「继续运行」。 */
export async function askToLeave(
  window: BrowserWindow | null,
  work: SessionPendingWork,
  action: LeaveAction,
): Promise<boolean> {
  const leaving = action === "quit" ? "退出" : "关闭窗口"
  const detail = [`${leaving}会结束当前会话。`]
  if (work.turns > 0) detail.push("Claude 正在回复，这一轮会被中断。")
  if (work.approvals > 0) detail.push(`${work.approvals} 个请求在等待你的审批。`)
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    message: "还有工作在运行",
    detail: detail.join("\n"),
    buttons: [leaving, "继续运行"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const owner = window !== null && !window.isDestroyed() ? window : null
  const { response } = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

/** 资源没能按时关闭时提示用户，应用保持运行。 */
export function showQuitFailure(reason: "failed" | "timeout"): void {
  dialog.showErrorBox(
    "无法安全退出",
    reason === "timeout"
      ? "资源仍在关闭，请手动关闭浏览器并等待清理完成。"
      : "浏览器或代理资源尚未关闭，请关闭相关浏览器后重试。",
  )
}
