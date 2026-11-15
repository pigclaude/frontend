// 托盘和通知共用的窗口导航；等受信主窗口订阅后再交付最新的目标。

import type { IpcMain, IpcMainInvokeEvent } from "electron"
import {
  takeWindowNavigationChannel,
  windowNavigationAvailableChannel,
  type WindowNavigationCommand,
} from "../window-navigation-contract"

/** 唤回窗口并递交系统入口指定的位置；窗口重新加载时也能收到尚未交付的目标。 */
export class WindowNavigation {
  #pending: WindowNavigationCommand | null = null

  /** 绑定现有窗口的唤回逻辑及只给主窗口发送事件的通道。 */
  constructor(
    private readonly restore: () => void,
    private readonly announce: (channel: string) => void,
  ) {}

  /** 只允许当前主窗口的顶层文档取走待处理命令。 */
  register(ipc: Pick<IpcMain, "handle">, trusted: (event: IpcMainInvokeEvent) => boolean): void {
    ipc.handle(takeWindowNavigationChannel, (event) => {
      if (!trusted(event)) throw new Error("UNTRUSTED_WINDOW_REQUEST")
      const command = this.#pending
      this.#pending = null
      return command
    })
  }

  /** 唤回并打开指定会话。由托盘或系统通知的点击回调调用。 */
  openSession(sessionId: string): void {
    this.open({ kind: "session", sessionId })
  }

  /** 唤回并跳转；重新加载或尚未出现的窗口可在订阅时读取最新目标。 */
  open(command: WindowNavigationCommand): void {
    this.#pending = command
    this.restore()
    this.announce(windowNavigationAvailableChannel)
  }
}
