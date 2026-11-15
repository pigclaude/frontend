// 为单个会话开本机 HTTP 代理监听。外部连接只经当前账号代理，换号或关闭时中止旧连接。

import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import type { Duplex } from "node:stream"
import { pipeline } from "node:stream/promises"
import { connectProxyTunnel, createHttpProxyForwarder } from "@pigclaude/proxy-connection"

/** 会话进程只获得无需认证的本机地址；上游地址和凭据留在主进程。 */
export type SessionProxyBridge = {
  readonly url: string
  /** 立即断开旧出口的连接；没有有效上游时拒绝请求。 */
  setUpstream(proxyUrl: string | null): void
  /** 停止监听并销毁连接，可重复调用。 */
  close(): void
}

type ProxyRoute = { url: string; signal: AbortSignal }

/** 在回环地址上启动一座独立的代理桥；监听失败时抛错，调用方不得直连。 */
export async function startSessionProxyBridge(proxyUrl: string): Promise<SessionProxyBridge> {
  let upstream: string | null = proxyUrl
  let controller = new AbortController()
  let closed = false
  const sockets = new Set<Duplex>()
  const currentRoute = (): ProxyRoute | null =>
    upstream === null ? null : { url: upstream, signal: controller.signal }
  const server = createServer((request, response) => {
    void relayHttp(request, response, currentRoute()).catch(() => {
      request.resume()
      if (response.headersSent) response.destroy()
      else if (!response.destroyed) response.writeHead(502).end()
    })
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", () => socket.destroy())
  })
  server.on("connect", (request, socket, head) => {
    void relayTunnel(request, socket, head, currentRoute()).catch(() => {
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    server.close()
    throw new Error("会话代理桥未就绪")
  }
  const disconnect = (): void => {
    controller.abort()
    for (const socket of sockets) socket.destroy()
  }
  const close = (): void => {
    if (closed) return
    closed = true
    disconnect()
    server.close()
  }
  server.on("error", close)
  return {
    url: `http://127.0.0.1:${address.port}`,
    setUpstream: (next) => {
      if (closed || upstream === next) return
      disconnect()
      upstream = next
      controller = new AbortController()
    },
    close,
  }
}

async function relayTunnel(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  route: ProxyRoute | null,
): Promise<void> {
  const authority = request.url ?? ""
  if (!/^(?:[\w.-]+|\[[\da-fA-F:]+\]):\d{1,5}$/.test(authority)) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
    return
  }
  if (route === null) throw new Error("会话代理不可用")
  const disconnected = new AbortController()
  const cancel = (): void => disconnected.abort()
  socket.once("close", cancel)
  const signal = AbortSignal.any([route.signal, disconnected.signal, AbortSignal.timeout(15_000)])
  let peer: Duplex
  try {
    peer = await connectProxyTunnel(route.url, authority, signal)
  } finally {
    socket.removeListener("close", cancel)
  }
  if (socket.destroyed || route.signal.aborted) {
    peer.destroy()
    return
  }
  peer.once("close", () => socket.destroy())
  socket.once("close", () => peer.destroy())
  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
  if (head.length > 0) peer.write(head)
  socket.pipe(peer).pipe(socket)
}

async function relayHttp(
  request: IncomingMessage,
  response: ServerResponse,
  route: ProxyRoute | null,
): Promise<void> {
  const url = request.url?.startsWith("http://") ? URL.parse(request.url) : null
  if (url === null || url.username || url.password) {
    request.resume()
    response.writeHead(400).end()
    return
  }
  const method = httpMethods.find((candidate) => candidate === request.method)
  if (method === undefined) {
    request.resume()
    response.writeHead(405).end()
    return
  }
  if (route === null) throw new Error("会话代理不可用")
  const forwarder = createHttpProxyForwarder(route.url)
  const downstream = new AbortController()
  const cancel = (): void => downstream.abort()
  response.once("close", cancel)
  try {
    const upstream = await forwarder.request(url, {
      method,
      body: method === "GET" || method === "HEAD" ? null : request,
      headers: headersAcrossProxy(request.headers, ["host"]),
      signal: AbortSignal.any([route.signal, downstream.signal]),
    })
    response.writeHead(upstream.statusCode, headersAcrossProxy(upstream.headers))
    await pipeline(upstream.body, response)
  } finally {
    response.removeListener("close", cancel)
    await forwarder.close()
  }
}

const httpMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const

const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]

function headersAcrossProxy(
  headers: IncomingHttpHeaders,
  extra: readonly string[] = [],
): IncomingHttpHeaders {
  const connection =
    headers.connection
      ?.toLowerCase()
      .split(",")
      .map((name) => name.trim()) ?? []
  const excluded = new Set([...hopHeaders, ...connection, ...extra])
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)))
}
