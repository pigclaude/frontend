// 负责退出应用和关闭主窗口前的确认：有进行中的回合或待处理的审批时先问用户，取消就保持原样。
import type { SessionPendingWork } from "./session/session-host-support"

/** 要确认的操作：退出应用，或关闭会结束会话的主窗口。 */
export type LeaveAction = "quit" | "close"

/** 退出确认的依赖：读取当前会中断的工作，以及向用户提问（同意离开时得到 true）。 */
export type QuitConfirmationOptions = {
  pendingWork: () => SessionPendingWork
  ask: (work: SessionPendingWork, action: LeaveAction) => Promise<boolean>
}

/** 关窗确认用到的窗口能力；Electron 的 BrowserWindow 满足这个形状。 */
export type GuardedWindow = {
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown
  close(): void
  isDestroyed(): boolean
}

/** 退出和关窗共用的确认。 */
export type QuitConfirmation = {
  /** 没有会中断的工作时立即得到 true；否则问用户，同意离开时得到 true。不会失败。 */
  confirm(action: LeaveAction): true | Promise<boolean>
  /** 主窗口关闭前确认；用户取消时窗口保持打开，会话和审批不受影响。 */
  guardClose(window: GuardedWindow): void
}

/** 创建退出确认。同一时间只问一次：正在问时再次触发，等的是同一个回答。 */
export function createQuitConfirmation(options: QuitConfirmationOptions): QuitConfirmation {
  let asking: Promise<boolean> | null = null
  const confirm = (action: LeaveAction): true | Promise<boolean> => {
    if (asking !== null) return asking
    const work = options.pendingWork()
    if (!hasPendingWork(work)) return true
    // 问不出答案时放行，不能让用户退不出应用。
    const question = options
      .ask(work, action)
      .catch(() => true)
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

function hasPendingWork(work: SessionPendingWork): boolean {
  return work.turns > 0 || work.approvals > 0
}
