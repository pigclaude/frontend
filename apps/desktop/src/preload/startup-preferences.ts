// 负责将通用设置的启动偏好请求转发给可信的主进程。

import { ipcRenderer } from "electron"
import type { StartupPreferencesBridge } from "../startup-preferences-contract"

/** 只公开布尔设置及系统支持状态，不传递启动参数和文件位置。 */
export function startupPreferencesBridge(): StartupPreferencesBridge {
  return {
    get: () => ipcRenderer.invoke("pigclaude:startup-preferences-get"),
    set: async (preference, value) =>
      (await ipcRenderer.invoke("pigclaude:startup-preferences-set", preference, value)) === true,
  }
}
