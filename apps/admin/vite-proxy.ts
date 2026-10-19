// 负责固定 Admin 开发代理目标与 Vite stock 故障日志边界，不记录回调查询或异常原文。
import { createLogger, type Logger } from "vite"
/** 保留常规 Vite 日志，只将 HTTP/WS proxy 错误降为固定故障元数据。 */
export function createAdminProxyLogger(): Logger {
  const logger = createLogger()
  const error = logger.error.bind(logger)
  logger.error = (message, options) => {
    if (/\b(?:http|ws) proxy (?:socket )?error:/.test(message)) {
      // stock error 附带 req.url 与 err.stack；不能继续转发 options.error。
      error("Admin API proxy request failed (500)", { timestamp: true })
    } else error(message, options)
  }
  return logger
}
/** 代理目标仅来自服务器配置，拒绝凭据、URL 路径与非受信 HTTP 主机。 */
export function adminProxyTarget(value: string): string {
  const url = new URL(value)
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || (url.hostname === "api" && url.port === "8788"))
      )) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("无效的固定后端目标")
  return url.origin
}
