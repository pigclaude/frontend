// 按用户授权转发单次 HTTPS 请求，固定出口，检查重定向并剥离会话外的认证信息。

import { createHmac, randomBytes } from "node:crypto"
import { createProxyAgent } from "@pigclaude/proxy-connection"
import { fetch, type Dispatcher } from "undici"
import { isProhibitedPluginDomain, normalizePluginNetworkDomain } from "./plugin-network-domains"
import {
  PluginSandboxError,
  type PluginNetworkAccess,
  type PluginSandboxNetwork,
} from "./plugin-sandbox-contract"

const routeSecret = randomBytes(32)
const redirectStatuses = new Set([301, 302, 303, 307, 308])
const transportHeaders = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "cookie",
  "cookie2",
  "set-cookie",
  "set-cookie2",
]

/** 仅许可声明与确认的交集，并保证原会话出口变化时旧实例的请求失败。 */
export async function createPluginSandboxNetwork(
  access: PluginNetworkAccess,
  readProxy: () => Promise<string | null>,
): Promise<PluginSandboxNetwork> {
  const expectedProxy = await readProxy().catch(() => {
    throw new PluginSandboxError("PLUGIN_EGRESS_UNAVAILABLE")
  })
  const permitted = approvedDomains(access)
  const egressId =
    expectedProxy === null
      ? "system"
      : "proxy:" + createHmac("sha256", routeSecret).update(expectedProxy).digest("hex")
  const target = (input: string) => approvedTarget(input, permitted)
  return Object.freeze({
    egressId,
    domains: Object.freeze([...permitted].sort()),
    permits: (url: string) => target(url) !== null,
    async forward(request: Request, scope: AbortSignal): Promise<Response> {
      const signal = AbortSignal.any([scope, request.signal])
      const url = target(request.url)
      if (url === null || signal.aborted) return Response.error()
      let proxy: Dispatcher | undefined
      try {
        const currentProxy = await readProxy()
        if (currentProxy !== expectedProxy || signal.aborted) return Response.error()
        if (currentProxy !== null) proxy = createProxyAgent(currentProxy)
        const headers = cleanHeaders(request.headers)
        headers.delete("content-length")
        const received = await fetch(url, {
          method: request.method,
          headers: Object.fromEntries(headers),
          redirect: "manual",
          credentials: "omit",
          signal,
          ...(request.body === null ? {} : { body: request.body, duplex: "half" }),
          ...(proxy === undefined ? {} : { dispatcher: proxy }),
        })
        const outgoing = cleanHeaders(new Headers([...received.headers]))
        const location = received.headers.get("location")
        if (location !== null && redirectStatuses.has(received.status)) {
          const redirected = URL.parse(location, url.href)
          const allowed = redirected === null ? null : target(redirected.href)
          if (allowed === null) {
            void received.body?.cancel().catch(() => undefined)
            return Response.error()
          }
          // Chromium 按 Fetch 规则处理下一跳。分区会重新通过本入口检查它。
          outgoing.set("location", allowed.href)
        }
        if (received.body !== null && decodedEncoding(outgoing.get("content-encoding"))) {
          outgoing.delete("content-encoding")
          outgoing.delete("content-length")
        }
        return new Response(received.body, {
          status: received.status,
          statusText: received.statusText,
          headers: outgoing,
        })
      } catch {
        return Response.error()
      } finally {
        // 正常关闭等待当前正文读完；该调用结束或取消时 signal 也会停止流。
        void proxy?.close().catch(() => undefined)
      }
    },
  })
}

function approvedDomains(access: PluginNetworkAccess): Set<string> {
  const declared = new Set(access.declaredDomains.map(normalizePluginNetworkDomain))
  const allowed = new Set<string>()
  for (const value of access.approvedDomains) {
    const domain = normalizePluginNetworkDomain(value)
    if (domain !== null && declared.has(domain) && !isProhibitedPluginDomain(domain))
      allowed.add(domain)
  }
  return allowed
}

function approvedTarget(input: string, domains: ReadonlySet<string>): URL | null {
  const url = URL.parse(input)
  if (!url || url.protocol !== "https:" || url.username !== "" || url.password !== "") return null
  const hostname = normalizePluginNetworkDomain(url.hostname)
  if (hostname === null || !domains.has(hostname)) return null
  url.hostname = hostname
  return url
}

function cleanHeaders(headers: Headers): Headers {
  const output = new Headers(headers)
  const connection = headers.get("connection")?.split(",") ?? []
  for (const name of connection) if (name.trim()) output.delete(name.trim())
  for (const name of transportHeaders) output.delete(name)
  return output
}

function decodedEncoding(encoding: string | null): boolean {
  return (
    encoding !== null &&
    encoding
      .split(",")
      .every((name) => ["gzip", "x-gzip", "br", "deflate"].includes(name.trim().toLowerCase()))
  )
}
