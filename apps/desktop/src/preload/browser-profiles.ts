// 暴露脱敏浏览器配置操作，视图不合法时拒绝响应，不把主进程内部数据带入页面。

import { ipcRenderer } from "electron"
import {
  isBrowserProfileView,
  type BrowserProfilesBridge,
} from "@pigclaude/contracts/browser-profile"

/** 创建号池浏览器配置的公开桥，全部目标和路径均留在主进程。 */
export function browserProfilesBridge(): BrowserProfilesBridge {
  return {
    list: async () => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:browser-profiles-list")
      if (!Array.isArray(value) || !value.every(isBrowserProfileView))
        throw new Error("浏览器配置响应不完整")
      return value
    },
    save: async (input) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:browser-profiles-save", input)
      if (!isBrowserProfileView(value)) throw new Error("浏览器配置保存响应不完整")
      return value
    },
    remove: (id) => ipcRenderer.invoke("pigclaude:browser-profiles-remove", id),
    region: async (id) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:browser-profiles-region", id)
      if (
        !value ||
        typeof value !== "object" ||
        !("ip" in value) ||
        typeof value.ip !== "string" ||
        !("countryCode" in value) ||
        typeof value.countryCode !== "string" ||
        !("timezone" in value) ||
        typeof value.timezone !== "string" ||
        !("locale" in value) ||
        typeof value.locale !== "string"
      )
        throw new Error("代理地区资料不完整")
      return {
        ip: value.ip,
        countryCode: value.countryCode,
        timezone: value.timezone,
        locale: value.locale,
      }
    },
  }
}
