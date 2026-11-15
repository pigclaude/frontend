// 桌面设置读取和修改本机唤醒偏好的 IPC 桥。
import { ipcRenderer } from "electron"

/** 手动唤醒偏好保存在主进程，读取与写入均由主进程确认。 */
export type KeepAwakeBridge = {
  get(): Promise<boolean>
  set(enabled: boolean): Promise<boolean>
}

/** 向受信设置页暴露本机唤醒设置的读取和更新。 */
export function keepAwakeBridge(): KeepAwakeBridge {
  return {
    get: () => ipcRenderer.invoke("pigclaude:keep-awake-get"),
    set: (enabled) => ipcRenderer.invoke("pigclaude:keep-awake-set", enabled),
  }
}
