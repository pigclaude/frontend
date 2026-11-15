// 负责退出流程里的系统对话框：有工作进行或文件没保存时确认是否离开、刷新前确认未保存的文件，
// 以及资源没能关闭时的提示。
import { dialog, type BrowserWindow } from "electron"
import type { LeaveAction, LeaveAnswer, LeaveWork } from "./quit-confirmation"
import type { QuitFailure } from "./shutdown"

const unsavedMessage = "有文件修改还没保存"
const quitFailureMessage: Record<QuitFailure, string> = {
  "session-save": "会话记录未能写入磁盘。请确认磁盘可用后重试退出。",
  timeout: "资源仍在关闭，请手动关闭浏览器并等待清理完成。",
  failed: "浏览器或代理资源尚未关闭，请关闭相关浏览器后重试。",
}

/**
 * 问用户是否离开。有未保存的文件时按钮是「保存并离开」「不保存」「取消」，默认保存；
 * 否则是「离开」和「继续运行」，默认继续运行。
 */
export async function askToLeave(
  window: BrowserWindow | null,
  work: LeaveWork,
  action: LeaveAction,
  signal?: AbortSignal,
): Promise<LeaveAnswer> {
  const leaving = action === "quit" ? "退出" : "关闭窗口"
  const detail = work.unsavedFiles > 0 ? [`${work.unsavedFiles} 个文件有未保存的修改。`] : []
  if (work.runningSessions > 0)
    detail.push(`${leaving}会结束 ${work.runningSessions} 个运行中的会话。`)
  if (work.turns > 0) detail.push(`有 ${work.turns} 个正在生成的回复会被中断。`)
  if (work.approvals > 0) detail.push(`${work.approvals} 个请求在等待你的审批。`)
  const unsaved = work.unsavedFiles > 0
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    message: unsaved ? unsavedMessage : "还有工作在运行",
    detail: detail.join("\n"),
    buttons: unsaved ? [`保存并${leaving}`, "不保存", "取消"] : [leaving, "继续运行"],
    defaultId: unsaved ? 0 : 1,
    cancelId: unsaved ? 2 : 1,
    noLink: true,
    ...(signal ? { signal } : {}),
  }
  const owner = ownerOf(window)
  const { response } = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return answerOf(response, unsaved)
}

/** 页面刷新前问未保存的文件怎么办；刷新事件要同步决定，所以用同步对话框。 */
export function askBeforeReload(window: BrowserWindow | null, unsavedFiles: number): LeaveAnswer {
  const options: Electron.MessageBoxSyncOptions = {
    type: "warning",
    message: unsavedMessage,
    detail: `${unsavedFiles} 个文件有未保存的修改，刷新页面会丢掉它们。`,
    buttons: ["保存并刷新", "不保存", "取消"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const owner = ownerOf(window)
  const response = owner
    ? dialog.showMessageBoxSync(owner, options)
    : dialog.showMessageBoxSync(options)
  return answerOf(response, true)
}

function ownerOf(window: BrowserWindow | null): BrowserWindow | null {
  return window !== null && !window.isDestroyed() ? window : null
}

function answerOf(response: number, unsaved: boolean): LeaveAnswer {
  if (!unsaved) return response === 0 ? "leave" : "stay"
  return response === 0 ? "save" : response === 1 ? "leave" : "stay"
}

/** 资源没能按时关闭时提示用户，应用保持运行。 */
export function showQuitFailure(reason: QuitFailure): void {
  dialog.showErrorBox("无法安全退出", quitFailureMessage[reason])
}
