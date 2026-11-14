// 负责退出应用和关闭主窗口前的确认：有进行中的回合、待处理的审批或未保存的文件时先问用户一次，
// 选保存就先保存，选不保存就先放弃修改，取消就保持原样。
import type { SessionPendingWork } from "./session/session-host-support"

/** 要确认的操作：退出应用，或关闭会结束会话的主窗口。 */
export type LeaveAction = "quit" | "close"

/** 离开前要处理的事：会中断的会话工作，以及工作台里没保存的文件数。 */
export type LeaveWork = SessionPendingWork & { unsavedFiles: number }

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
  isDestroyed(): boolean
}

/** 退出和关窗共用的确认。 */
export type QuitConfirmation = {
  /** 没有要处理的事时立即得到 true；否则问用户，可以离开时得到 true。不会失败。 */
  confirm(action: LeaveAction): true | Promise<boolean>
  /** 主窗口关闭前确认；用户取消或保存失败时窗口保持打开，会话、审批和文件都不受影响。 */
  guardClose(window: GuardedWindow): void
}

/** 创建退出确认。同一时间只问一次：正在问时再次触发，等的是同一个回答。 */
export function createQuitConfirmation(options: QuitConfirmationOptions): QuitConfirmation {
  let asking: Promise<boolean> | null = null
  const settle = async (answer: LeaveAnswer, work: LeaveWork): Promise<boolean> => {
    if (answer === "stay") return false
    if (answer === "save") return options.saveFiles().catch(() => false)
    if (work.unsavedFiles > 0) await options.discardFiles().catch(() => undefined)
    return true
  }
  const confirm = (action: LeaveAction): true | Promise<boolean> => {
    if (asking !== null) return asking
    const work = options.pendingWork()
    if (!hasPendingWork(work)) return true
    // 问不出答案时放行，不能让用户退不出应用；未保存的文件仍由页面拦下刷新和关闭。
    const question = options
      .ask(work, action)
      .then(
        (answer) => settle(answer, work),
        () => true,
      )
      .finally(() => {
        asking = null
      })
    asking = question
    return question
  }
  return {
    confirm,
    guardClose(window) {
      let confirmed = false
      window.on("close", (event) => {
        if (confirmed) {
          confirmed = false
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

function hasPendingWork(work: LeaveWork): boolean {
  return work.turns > 0 || work.approvals > 0 || work.unsavedFiles > 0
}
