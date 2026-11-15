// 约束 Agent 开发页面的 Chromium 分区，只让回环地址和无出站的页面数据进入。

import type { App, Session } from "electron"

const connectionAllowlistFeatures = [
  "ConnectionAllowlists",
  "OverrideConnectionAllowlistOriginTrial",
]
const defaultConnectionAllowlist = '("http://*:*/*" "https://*:*/*");redirects=allow'
let connectionAllowlistEnabled = false

type AgentBrowserCommandLine = Pick<App["commandLine"], "appendSwitch" | "getSwitchValue">

/**
 * 在 Chromium 就绪前开启引擎的 Connection-Allowlist 能力，并保留既有开关。
 * 只有 Agent 分区主动加限制头并禁止 Service Worker。其他分区的站点自行发送实验头时，Chromium 也可能执行该头。
 */
export function configureAgentBrowserRuntime(
  commandLine: AgentBrowserCommandLine | undefined,
): void {
  connectionAllowlistEnabled = false
  if (!commandLine) return
  const disabled = featureNames(commandLine.getSwitchValue("disable-features"))
  if (connectionAllowlistFeatures.some((name) => disabled.includes(name))) return
  const enabled = commandLine.getSwitchValue("enable-features")
  const enabledNames = featureNames(enabled)
  const required = connectionAllowlistFeatures.filter((name) => !enabledNames.includes(name))
  if (required.length > 0)
    commandLine.appendSwitch("enable-features", [enabled, ...required].filter(Boolean).join(","))
  connectionAllowlistEnabled = true
}

function featureNames(value: string): string[] {
  return value.split(",").map((flag) => flag.split(/[:<]/, 1)[0]?.trim() ?? "")
}

/** Agent 导航只接受不带凭据的 HTTP(S) 回环地址。 */
export function isAgentBrowserAddress(value: string): boolean {
  if (value.length > 4096) return false
  const url = URL.parse(value)
  return (
    url !== null &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    (url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname))
  )
}

/** 验证分区资源；页面生成的 data/blob 与 iframe 的 srcdoc 不需要远端连接。 */
export function isAgentBrowserResource(value: string): boolean {
  const protocol = URL.parse(value)?.protocol
  return (
    protocol === "data:" ||
    protocol === "blob:" ||
    value === "about:srcdoc" ||
    isAgentBrowserAddress(value)
  )
}

/** Agent 浏览器的分区就绪状态及被拦截的请求数。 */
export type AgentBrowserNetwork = {
  readonly ready: Promise<void>
  readonly blockedRequests: number
  /** 记录导航入口拦截的请求，不暴露目标地址。 */
  markBlocked(): void
}

const installed = new WeakMap<Session, AgentBrowserNetwork>()

/** 为 Agent 的内存分区设置回环范围、原生 WebRTC 限制和下载阻断。重复绑定使用同一计数。 */
export function installAgentBrowserNetwork(partition: Session): AgentBrowserNetwork {
  if (!connectionAllowlistEnabled) throw new Error("WORKBENCH_BROWSER_POLICY_UNAVAILABLE")
  const prior = installed.get(partition)
  if (prior !== undefined) return prior
  let blocked = 0
  const ready = partition.setProxy({ mode: "direct" })
  void ready.catch(() => undefined)
  const network: AgentBrowserNetwork = {
    ready,
    get blockedRequests() {
      return blocked
    },
    markBlocked() {
      blocked += 1
    },
  }
  partition.webRequest.onBeforeRequest((details, respond) => {
    const cancel = !isAgentBrowserResource(details.url)
    if (cancel) network.markBlocked()
    respond({ cancel })
  })
  partition.webRequest.onBeforeSendHeaders(({ requestHeaders }, respond) => {
    // 新的内存分区没有 Service Worker。阻止安装脚本，让所有可执行文档都受原生响应策略约束。
    const cancel = Object.entries(requestHeaders).some(
      ([key, value]) =>
        key.toLowerCase() === "service-worker" && value.trim().toLowerCase() === "script",
    )
    if (cancel) network.markBlocked()
    respond({ cancel })
  })
  partition.webRequest.onHeadersReceived(({ resourceType, responseHeaders }, respond) => {
    if (resourceType === "mainFrame" || resourceType === "subFrame")
      respond({ responseHeaders: blockWebRtc(responseHeaders) })
    else respond({})
  })
  partition.on("will-download", (event) => {
    network.markBlocked()
    event.preventDefault()
  })
  installed.set(partition, network)
  return network
}

function blockWebRtc(headers: Record<string, string[]> | undefined): Record<string, string[]> {
  const response = { ...headers }
  const matching = Object.keys(response).filter(
    (key) => key.toLowerCase() === "connection-allowlist",
  )
  const existing = matching
    .flatMap((key) => response[key] ?? [])
    .join(", ")
    .trim()
  for (const key of matching) delete response[key]
  const value = existing || defaultConnectionAllowlist
  // Chromium 只读 structured field 的首个列表成员，同名参数取最后一个值。
  // 当前 Chromium 对非空畸形列表保留默认的 WebRTC 拒绝策略，原生验收覆盖解析失败的分支。
  const first = /^(?:[^",]|"(?:[^"\\]|\\.)*")*/.exec(value)?.[0] ?? ""
  response["Connection-Allowlist"] = [first.trimEnd() + ";webrtc=block" + value.slice(first.length)]
  return response
}
