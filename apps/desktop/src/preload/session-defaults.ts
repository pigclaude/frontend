// 暴露新会话默认设置的读写；主进程回给的设置不完整时拒绝，不把它交给页面。

import { ipcRenderer } from "electron"
import {
  isSessionDefaults,
  type SessionDefaults,
  type SessionDefaultsPatch,
} from "../session-defaults-contract"

/** 页面能用的默认设置读写。 */
export type SessionDefaultsBridge = {
  get: () => Promise<SessionDefaults>
  /** 只改给出的项，返回保存后的完整设置。 */
  set: (patch: SessionDefaultsPatch) => Promise<SessionDefaults>
}

/** 创建默认设置的公开桥。 */
export function sessionDefaultsBridge(): SessionDefaultsBridge {
  return {
    get: async () => checked(await ipcRenderer.invoke("pigclaude:session-defaults-get")),
    set: async (patch) =>
      checked(await ipcRenderer.invoke("pigclaude:session-defaults-set", patch)),
  }
}

function checked(value: unknown): SessionDefaults {
  if (!isSessionDefaults(value)) throw new Error("INVALID_SESSION_DEFAULTS_RESPONSE")
  return value
}
