// 负责用户和 Agent 浏览器的 URL 校验，以及原生页面的导航限制。
import type { WebContents } from "electron"
import { isAgentBrowserAddress, type AgentBrowserNetwork } from "./agent-browser-network"

const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])

/** 解析允许的浏览器地址，只接受不带内嵌凭据的 HTTP 或 HTTPS。 */
export function workbenchBrowserUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 4096) throw new Error("URL_NOT_ALLOWED")
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("URL_NOT_ALLOWED")
  }
  return url
}

/** Agent 浏览器在申请审批和打开页面前都使用既有的回环地址限制。 */
export function workbenchAgentBrowserUrl(value: unknown): URL {
  const url = workbenchBrowserUrl(value)
  if (!isAgentBrowserAddress(url.href)) throw new Error("PREVIEW_URL_NOT_ALLOWED")
  return url
}

/** 用户浏览器沿用原协议，独立预览窗口仍只接受原回环地址。 */
export function allowsWorkbenchBrowserAddress(target: string, local: boolean): boolean {
  try {
    const url = workbenchBrowserUrl(target)
    return !local || loopback.has(url.hostname)
  } catch {
    return false
  }
}

/** 为原生网页保留现有导航和弹窗限制；Agent 使用它自己的回环网络策略。 */
export function configureContents(
  contents: WebContents,
  local = false,
  agent?: AgentBrowserNetwork,
  openInSameTab?: (url: string) => void,
): void {
  if (agent) contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
  function canNavigate(target: string, isFrame = false): boolean {
    if (agent) return (isFrame && target === "about:srcdoc") || isAgentBrowserAddress(target)
    return (isFrame && target === "about:blank") || allowsWorkbenchBrowserAddress(target, local)
  }
  contents.on("will-navigate", (event) => {
    if (!canNavigate(event.url)) {
      agent?.markBlocked()
      event.preventDefault()
    }
  })
  contents.on("will-redirect", (event) => {
    if (!canNavigate(event.url, !event.isMainFrame)) {
      agent?.markBlocked()
      event.preventDefault()
    }
  })
  contents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame && !canNavigate(event.url, true)) {
      agent?.markBlocked()
      event.preventDefault()
    }
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (agent && isAgentBrowserAddress(url)) openInSameTab?.(url)
    else agent?.markBlocked()
    return { action: "deny" }
  })
}
