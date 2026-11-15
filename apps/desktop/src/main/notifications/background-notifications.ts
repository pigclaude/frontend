// 负责后台通知的发送条件、点击目标和 macOS 发送失败时的托盘反馈。

import { keepsMembershipRuntime, type MembershipState } from "@pigclaude/contracts/membership"
import type { BrowserWindow } from "electron"
import type { SessionEnvelope } from "../session/session-envelope"
import {
  backgroundNoticeFromSession,
  formatBackgroundNotice,
  type BackgroundNotice,
  type NotificationSession,
  type SystemNotificationContent,
} from "./background-notification"

type NotificationWindow = Pick<
  BrowserWindow,
  "isDestroyed" | "isVisible" | "isMinimized" | "isFocused"
>

/** 本机通知边界只接收白名单内容，以及点击和失败的处理函数。 */
export type BackgroundNotificationPorts = {
  platform: NodeJS.Platform
  window: () => NotificationWindow | null
  show: (
    content: SystemNotificationContent,
    handlers: { click: () => void; failed: () => void },
  ) => void
  openSession: (id: string) => void
  openWindow: () => void
  trayBadge: (enabled: boolean) => void
}

/** 把后台事件送给本机通知器，保证不依赖渲染进程或通知平台的状态。 */
export function createBackgroundNotifications(ports: BackgroundNotificationPorts) {
  let disposed = false
  let badge = false
  let memberWasActive = false
  let membershipState: MembershipState | null = null
  const failedTurns = new Map<string, number>()

  const canShow = () => !disposed && !isForeground(ports.window())
  const setBadge = (enabled: boolean): void => {
    if (badge === enabled) return
    try {
      ports.trayBadge(enabled)
      badge = enabled
    } catch {
      // 原生托盘不可用时不阻塞会话事件或应用退出。
    }
  }
  const announce = (notice: BackgroundNotice, session?: NotificationSession | null): boolean => {
    if (!canShow()) return false
    const sessionId = "sessionId" in notice ? notice.sessionId : null
    let handled = false
    const failed = () => {
      if (handled) return
      handled = true
      if (ports.platform === "darwin" && canShow()) setBadge(true)
    }
    const click = () => {
      if (disposed || handled) return
      handled = true
      if (sessionId === null) ports.openWindow()
      else ports.openSession(sessionId)
    }
    try {
      ports.show(formatBackgroundNotice(notice, session), { click, failed })
    } catch {
      failed()
    }
    return true
  }
  return {
    /** 将后台通知提交给系统。前台或已经销毁时返回 false。 */
    announce,
    /** 监听现场会话事件；读取标题期间窗口回到前台时取消发送。 */
    async session(
      envelope: SessionEnvelope,
      describe: (id: string) => Promise<NotificationSession | null>,
    ): Promise<void> {
      if (disposed) return
      const { event, sessionId, seq } = envelope
      if (sessionId === null) return
      // 在途回合随 CLI 一起失败时，同一会话的终止信封紧跟回合失败。
      const precedingFailure = failedTurns.get(sessionId)
      if (seq !== null) {
        if (event.type === "turn-ended" && event.status === "error") failedTurns.set(sessionId, seq)
        else failedTurns.delete(sessionId)
      }
      if (!canShow()) return
      if (
        event.type === "ended" &&
        ((seq !== null && precedingFailure === seq - 1) || isDefiniteLoss(membershipState))
      )
        return
      if (
        event.type === "turn-ended" &&
        event.errorCode === "MEMBERSHIP_REQUIRED" &&
        isDefiniteLoss(membershipState)
      )
        return
      const notice = backgroundNoticeFromSession(envelope)
      if (notice === null) return
      announce(notice, await describe(notice.sessionId).catch(() => null))
    },
    /** 会员曾有效，并明确失效时只提醒一次；短暂网络失败不视作失效。 */
    membership(state: MembershipState): void {
      membershipState = state
      if (keepsMembershipRuntime(state)) memberWasActive = true
      if (memberWasActive && isDefiniteLoss(state)) {
        memberWasActive = false
        announce({ kind: "membership" })
      }
    },
    /** 窗口回到前台就清除通知角标，待审批角标由托盘独立维护。 */
    windowFocused(): void {
      setBadge(false)
    },
    /** 退出清理后禁止发送和处理旧通知的点击。 */
    dispose(): void {
      disposed = true
      failedTurns.clear()
      setBadge(false)
    },
  }
}

function isForeground(window: NotificationWindow | null): boolean {
  return (
    window !== null &&
    !window.isDestroyed() &&
    window.isVisible() &&
    !window.isMinimized() &&
    window.isFocused()
  )
}

function isDefiniteLoss(state: MembershipState | null): boolean {
  return (
    state === "expired" ||
    state === "device_revoked" ||
    state === "signed_out" ||
    state === "verification_required"
  )
}
