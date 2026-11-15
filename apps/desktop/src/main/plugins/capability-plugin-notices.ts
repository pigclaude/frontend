// 限制能力插件发送应用内提示的频率，只向主窗口交付有界纯文本。

import {
  readCapabilityPluginNotice,
  type CapabilityPluginNotice,
} from "../../capability-plugin-notice-contract"
import { isCapabilityPluginId } from "./capability-plugin-paths"

const noticeIntervalMs = 5_000

/** 每个插件标识共用一份通知间隔，跨会话和网络出口均生效。 */
export class CapabilityPluginNotices {
  readonly #allowedAfter = new Map<string, number>()

  /** publish 由桌面持有并负责选择受信窗口，now 返回单调时间。 */
  constructor(
    private readonly publish: (notice: CapabilityPluginNotice) => boolean | void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** 使用本次调用的宿主标识与清单名称。成功提交给窗口时返回 true。 */
  show(pluginId: string, pluginName: string, message: string): boolean {
    if (!isCapabilityPluginId(pluginId)) return false
    const now = this.now()
    for (const [id, deadline] of this.#allowedAfter) {
      if (deadline > now) break
      this.#allowedAfter.delete(id)
    }
    if (this.#allowedAfter.has(pluginId)) return false
    const notice = readCapabilityPluginNotice({ pluginName, message })
    if (notice === null) return false

    this.#allowedAfter.set(pluginId, now + noticeIntervalMs)
    try {
      if (this.publish(notice) !== false) return true
    } catch {
      // 窗口可能在检查后关闭，此次不消耗发送间隔。
    }
    this.#allowedAfter.delete(pluginId)
    return false
  }
}
