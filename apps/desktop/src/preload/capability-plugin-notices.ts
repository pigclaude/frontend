// 仅向主窗口暴露应用内插件通知的订阅，解析载荷后丢弃原始 IPC 事件。

import { ipcRenderer, type IpcRendererEvent } from "electron"
import {
  capabilityPluginNoticeChannel,
  readCapabilityPluginNotice,
  type CapabilityPluginNoticesBridge,
} from "../capability-plugin-notice-contract"

/** 创建固定频道的通知订阅，返回原侦听器的解除函数。 */
export function capabilityPluginNoticesBridge(): CapabilityPluginNoticesBridge {
  return {
    subscribe(listener) {
      const receive = (_event: IpcRendererEvent, value: unknown) => {
        const notice = readCapabilityPluginNotice(value)
        if (notice !== null) listener(notice)
      }
      ipcRenderer.on(capabilityPluginNoticeChannel, receive)
      return () => {
        ipcRenderer.removeListener(capabilityPluginNoticeChannel, receive)
      }
    },
  }
}
