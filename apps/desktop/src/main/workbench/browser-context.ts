// 配置工作台浏览器分区、允许的地址和内容导航规则。
import { session, type Rectangle, type WebContents, type WebContentsView } from "electron"
import type { WorkbenchBrowserBounds, WorkbenchBrowserPage } from "../../workbench-contract"
import { isAgentBrowserAddress, type AgentBrowserNetwork } from "./agent-browser-network"

const partition = "persist:pigclaude-workbench-browser"
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])

/** 检查普通本机预览支持的主机。 */
export function isWorkbenchLoopback(url: URL): boolean {
  return loopback.has(url.hostname)
}

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

/** 检查地址能否用于普通浏览器或独立本机预览。 */
export function allowsWorkbenchBrowserAddress(target: string, local = false): boolean {
  try {
    const url = workbenchBrowserUrl(target)
    return !local || isWorkbenchLoopback(url)
  } catch {
    return false
  }
}

/** 配置独立标签的导航和弹窗；Agent 标签同时使用既有环回网络策略。 */
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
  contents.setWindowOpenHandler(({ url, postBody }) => {
    if (agent && postBody === undefined && isAgentBrowserAddress(url)) openInSameTab?.(url)
    else agent?.markBlocked()
    return { action: "deny" }
  })
}

/** 普通浏览器用原有的持久预览分区。 */
export function browserSession() {
  return restrictedSession(partition)
}

/** Agent 标签使用各自的非持久分区。 */
export function agentSession(id: string) {
  return restrictedSession("pigclaude-workbench-agent-" + id)
}

/** 将浏览器限制到所在主窗口中的内容区，并同步该标签需要的缩放倍率。 */
export function applyWorkbenchBrowserBounds(
  view: WebContentsView,
  available: Rectangle,
  bounds: WorkbenchBrowserBounds,
  previousScale: number,
): number {
  const x = Math.min(Math.max(0, bounds.x), available.width)
  const y = Math.min(Math.max(0, bounds.y), available.height)
  view.setBounds({
    x,
    y,
    width: Math.min(bounds.width, available.width - x),
    height: Math.min(bounds.height, available.height - y),
  })
  if (previousScale !== bounds.scale) view.webContents.setZoomFactor(bounds.scale)
  return bounds.scale
}

/** 提取浏览器视图的可公开页面状态；首次已批准的导航可在提交前显示目标地址。 */
export function workbenchBrowserPage(
  contents: WebContents,
  state: {
    activity?: WorkbenchBrowserPage["activity"]
    error?: WorkbenchBrowserPage["error"]
    crashed?: WorkbenchBrowserPage["crashed"]
  },
): WorkbenchBrowserPage {
  const approvedUrl = state.activity?.kind === "navigate" ? state.activity.target : ""
  return {
    url: contents.getURL() || state.error?.url || approvedUrl,
    title: contents.getTitle(),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    ...(state.error ? { error: state.error } : {}),
    ...(state.crashed ? { crashed: state.crashed } : {}),
    ...(state.activity ? { activity: state.activity } : {}),
  }
}

function restrictedSession(name: string) {
  const value = session.fromPartition(name)
  value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  value.setPermissionCheckHandler(() => false)
  return value
}
