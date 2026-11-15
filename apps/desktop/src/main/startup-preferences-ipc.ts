// 负责通用设置启动偏好的 IPC 校验，系统和文件路径由主进程管理。

import type { IpcMain, IpcMainInvokeEvent } from "electron"
import type { StartupPreferencesBridge } from "../startup-preferences-contract"

/** 只允许可信主窗口读取或修改启动偏好，系统异常映射为固定错误码。 */
export function registerStartupPreferencesIpc(
  ipc: Pick<IpcMain, "handle">,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  preferences: StartupPreferencesBridge,
): void {
  ipc.handle("pigclaude:startup-preferences-get", (event) => {
    if (!trusted(event)) throw new Error("UNTRUSTED_STARTUP_PREFERENCE_REQUEST")
    return preferences.get().catch(() => {
      throw new Error("STARTUP_PREFERENCES_READ_FAILED")
    })
  })
  ipc.handle("pigclaude:startup-preferences-set", (event, preference: unknown, value: unknown) => {
    if (!trusted(event)) throw new Error("UNTRUSTED_STARTUP_PREFERENCE_REQUEST")
    if ((preference !== "openAtLogin" && preference !== "showInDock") || typeof value !== "boolean")
      throw new Error("STARTUP_PREFERENCE_INVALID")
    return preferences.set(preference, value).catch(() => {
      throw new Error("STARTUP_PREFERENCE_SAVE_FAILED")
    })
  })
}
