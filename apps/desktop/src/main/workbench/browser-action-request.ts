// 连接已验证的浏览器审批信息与只在批准后执行的动作。

import type { BrowserPermissionContext } from "../../browser-permission-contract"

/** 捕获当前目标；执行闭包再次验证页面与元素并返回最新快照。 */
export type PreparedBrowserAction = {
  context: Extract<BrowserPermissionContext, { kind: "navigate" | "click" }>
  execute(signal?: AbortSignal, assertAllowed?: () => void): Promise<string>
}

/** 只从受信实现报固定动作错误，方便 Claude 请求新快照或重试。 */
export class BrowserActionError extends Error {
  /** 保存能直接返回给模型的固定英文说明。 */
  constructor(message: string) {
    super(message)
    this.name = "BrowserActionError"
  }
}
