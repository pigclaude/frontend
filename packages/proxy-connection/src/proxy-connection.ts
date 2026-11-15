// 负责创建直接连接上游代理的 dispatcher 和 CONNECT 隧道，并统一 Basic 账号密码的编码语义。

import type { Duplex } from "node:stream"
import { Client, ProxyAgent, type Dispatcher } from "undici"

/** 创建上游代理连接；任一凭据非空时发送 Basic，且代理 URI 不包含凭据。 */
export function createProxyAgent(proxyUrl: string): ProxyAgent {
  const { endpoint, token } = proxyEndpoint(proxyUrl)
  return new ProxyAgent({ uri: endpoint.href, ...(token === undefined ? {} : { token }) })
}

/** 创建普通 HTTP 转发端口；用绝对请求目标访问指定代理，认证头只交给该代理。 */
export function createHttpProxyForwarder(proxyUrl: string) {
  const { endpoint, token } = proxyEndpoint(proxyUrl)
  const client = new Client(endpoint.origin)
  return {
    request: (
      target: URL,
      options: Pick<Dispatcher.RequestOptions, "method" | "body" | "signal"> & {
        headers: Record<string, string | string[] | undefined>
      },
    ) =>
      client.request({
        ...options,
        path: target.href,
        headers: {
          ...options.headers,
          host: target.host,
          ...(token === undefined ? {} : { "proxy-authorization": token }),
        },
      }),
    close: () => client.destroy(),
  }
}

/** 只经指定的 HTTP 或 HTTPS 代理打开 CONNECT 隧道；调用方负责关闭返回的 socket。 */
export async function connectProxyTunnel(
  proxyUrl: string,
  authority: string,
  signal: AbortSignal,
): Promise<Duplex> {
  const { endpoint, token } = proxyEndpoint(proxyUrl)
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("不支持的上游代理协议")
  }
  const client = new Client(endpoint.origin)
  try {
    const { socket, statusCode } = await client.connect({
      path: authority,
      headers: {
        host: authority,
        ...(token === undefined ? {} : { "proxy-authorization": token }),
      },
      signal,
    })
    socket.on("error", () => undefined)
    if (statusCode !== 200) {
      socket.destroy()
      throw new Error("上游代理拒绝连接")
    }
    return socket
  } finally {
    await client.destroy()
  }
}

function proxyEndpoint(proxyUrl: string): { endpoint: URL; token?: string } {
  const endpoint = new URL(proxyUrl)
  const username = decodeURIComponent(endpoint.username)
  const password = decodeURIComponent(endpoint.password)
  endpoint.username = ""
  endpoint.password = ""
  if (username === "" && password === "") return { endpoint }
  const token = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
  return { endpoint, token }
}
