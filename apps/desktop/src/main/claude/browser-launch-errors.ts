// 定义启动器的脱敏错误和未完成回收的实例，供账号服务保持资源清理屏障。

import type { LaunchedBrowser } from "./fingerprint-chromium"

/** 浏览器启动器的稳定错误码。 */
export type BrowserErrorCode =
  | "BROWSER_MISSING"
  | "BROWSER_START_FAILED"
  | "BROWSER_STOP_FAILED"
  | "BROWSER_PROFILE_DELETE_FAILED"

/** PigBrowser 启动错误；错误消息不含授权地址或凭据。 */
export class BrowserLaunchError extends Error {
  readonly code: BrowserErrorCode

  /** 创建带稳定错误码的脱敏错误。 */
  constructor(code: BrowserErrorCode, message: string) {
    super(message)
    this.name = "BrowserLaunchError"
    this.code = code
  }
}

/** 启动失败但未确认退出的实例，必须由调用方继续回收。 */
export class BrowserStartupCleanupError extends BrowserLaunchError {
  readonly browser: LaunchedBrowser

  /** 保留实际实例，不把回收失败伪装成已经结束。 */
  constructor(browser: LaunchedBrowser) {
    super("BROWSER_STOP_FAILED", "无法确认浏览器已退出，请手动关闭后重试")
    this.name = "BrowserStartupCleanupError"
    this.browser = browser
  }
}
