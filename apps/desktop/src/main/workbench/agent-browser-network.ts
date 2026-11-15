// 约束 Agent 开发页面的 Chromium 分区，只让回环地址和无出站的页面数据进入。

import type { Session } from "electron"

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

/** 为 Agent 的内存分区设置直接连接、请求过滤和下载阻断，重复绑定使用同一计数。 */
export function installAgentBrowserNetwork(partition: Session): AgentBrowserNetwork {
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
  partition.on("will-download", (event) => {
    network.markBlocked()
    event.preventDefault()
  })
  installed.set(partition, network)
  return network
}
