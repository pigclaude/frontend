// 负责退出应用和关闭主窗口前的确认：有运行中的会话、待处理的审批或未保存的文件时先问用户一次，
// 选保存就先保存，选不保存就先放弃修改，取消就保持原样。
import type { ScheduledTaskSummaryItem } from "../scheduled-tasks-contract"
import type { SessionPendingWork } from "./session/session-host-support"

/** 要确认的操作：退出应用，或关闭会结束会话的主窗口。 */
export type LeaveAction = "quit" | "close"

/** 离开时会中断的会话、未保存文件和当前已启用的定时任务。 */
export type LeaveWork = SessionPendingWork & {
  unsavedFiles: number
  scheduledTasks?: readonly ScheduledTaskSummaryItem[]
}

/** 用户的回答：保存文件后离开、不保存直接离开，或者留下。 */
export type LeaveAnswer = "save" | "leave" | "stay"

/** 退出确认的依赖：读取当前要处理的事、向用户提问，以及请主窗口保存或放弃未保存的文件。 */
export type QuitConfirmationOptions = {
  pendingWork: () => LeaveWork
  ask: (work: LeaveWork, action: LeaveAction) => Promise<LeaveAnswer>
  /** 全部保存成功时得到 true；有文件没保存成功时得到 false，主窗口会提示原因。 */
  saveFiles: () => Promise<boolean>
  /** 放弃全部未保存的修改，之后关窗、退出不再被页面拦下。 */
  discardFiles: () => Promise<void>
}

/** 关窗确认用到的窗口能力；Electron 的 BrowserWindow 满足这个形状。 */
export type GuardedWindow = {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown
  close(): void
  hide(): void
  isDestroyed(): boolean
}

/** 退出和关窗共用的确认。 */
export type QuitConfirmation = {
  /** 没有要处理的事时立即得到 true；否则问用户，可以离开时得到 true。不会失败。 */
  confirm(action: LeaveAction): true | Promise<boolean>
  /** 关窗可按偏好隐藏；真正关闭时才确认会话、审批和未保存的文件。 */
  guardClose(window: GuardedWindow, closeToTray?: () => boolean): void
  /** 用户已经同意离开：之后的关窗和页面卸载不再询问。 */
  leaving(): boolean
  /** 系统要求退出时放行关闭；迟到的对话框回答不会触发保存或丢弃。 */
  allowSystemShutdown(): void
  /** 离开没有完成（例如退出时资源没能关闭）时撤回同意，下次离开重新询问。 */
  reset(): void
}

/** 创建退出确认。同一时间只问一次：正在问时再次触发，等的是同一个回答。 */
export function createQuitConfirmation(options: QuitConfirmationOptions): QuitConfirmation {
  let asking: Promise<boolean> | null = null
  let approved = false
  const settle = async (answer: LeaveAnswer, work: LeaveWork): Promise<boolean> => {
    if (approved) return true
    if (answer === "stay") return false
    if (answer === "save") return options.saveFiles().catch(() => false)
    if (work.unsavedFiles > 0) await options.discardFiles().catch(() => undefined)
    return true
  }
  const confirm = (action: LeaveAction): true | Promise<boolean> => {
    if (approved) return true
    if (asking !== null) return asking
    const work = options.pendingWork()
    if (!hasPendingWork(work)) {
      approved = true
      return true
    }
    // 问不出答案时放行，不能让用户退不出应用；未保存的文件仍由页面拦下刷新和关闭。
    const question = options
      .ask(work, action)
      .then(
        (answer) => settle(answer, work),
        () => true,
      )
      .then((leave) => {
        approved ||= leave
        return approved
      })
      .finally(() => {
        asking = null
      })
    asking = question
    return question
  }
  return {
    confirm,
    leaving: () => approved,
    allowSystemShutdown() {
      approved = true
    },
    reset() {
      approved = false
    },
    guardClose(window, closeToTray) {
      let confirmed = false
      approved = false
      window.on("close", (event) => {
        if (approved || confirmed) {
          confirmed = false
          return
        }
        if (asking === null && closeToTray?.()) {
          event.preventDefault()
          window.hide()
          return
        }
        if (asking === null && !hasPendingWork(options.pendingWork())) return
        event.preventDefault()
        void Promise.resolve(confirm("close")).then((leave) => {
          if (!leave || window.isDestroyed()) return
          confirmed = true
          window.close()
        })
      })
    },
  }
}

/** 判断退出或关窗是否会影响会话、审批、未保存的文件或启用的定时任务。 */
export function hasPendingWork(work: LeaveWork): boolean {
  return (
    work.runningSessions > 0 ||
    work.turns > 0 ||
    work.approvals > 0 ||
    work.unsavedFiles > 0 ||
    (work.scheduledTasks?.length ?? 0) > 0
  )
}
