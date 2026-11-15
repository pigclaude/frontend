// 向主窗口交付待处理的原生导航；订阅切换时保留尚未收到的命令。

import { ipcRenderer } from "electron"
import {
  isWindowNavigationCommand,
  takeWindowNavigationChannel,
  windowNavigationAvailableChannel,
  type WindowNavigationCommand,
} from "../window-navigation-contract"

type Listener = (command: WindowNavigationCommand) => void

/** 创建单一主窗口订阅入口，渲染层加载后主动补拉唤回前发出的命令。 */
export function windowNavigationListener(): (listener: Listener) => () => void {
  let current: Listener | null = null
  let pending: WindowNavigationCommand | null = null
  const deliver = () => {
    if (pending === null || current === null) return
    const command = pending
    pending = null
    current(command)
  }
  const receive = () => {
    void ipcRenderer
      .invoke(takeWindowNavigationChannel)
      .then((command: unknown) => {
        if (!isWindowNavigationCommand(command)) return
        pending = command
        deliver()
      })
      .catch(() => undefined)
  }
  return (listener) => {
    current = listener
    ipcRenderer.on(windowNavigationAvailableChannel, receive)
    deliver()
    receive()
    return () => {
      if (current === listener) current = null
      ipcRenderer.removeListener(windowNavigationAvailableChannel, receive)
    }
  }
}
