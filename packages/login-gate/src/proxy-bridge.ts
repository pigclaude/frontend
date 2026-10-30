// 负责在登录流程中提供只监听 loopback 的 HTTP 代理桥；桥的上游是账号绑定的 IP 代理。

import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { request as httpsRequest } from "node:https"
import { connect as netConnect, isIP, type Socket } from "node:net"
import { connect as tlsConnect } from "node:tls"

const connectTimeoutMs = 15_000
const idleTimeoutMs = 60_000
const maxProxyHeaderBytes = 8_192
const maxPendingConnectBytes = 1024 * 1024

/** 代理桥的稳定错误码。 */
export type ProxyBridgeErrorCode = "INVALID_PROXY_URL" | "UNSUPPORTED_PROXY_SCHEME"

/** 代理桥配置错误。保证调用方能把错误码映射成用户可见文案。 */
export class ProxyBridgeError extends Error {
  readonly code: ProxyBridgeErrorCode

  /** 创建带稳定错误码的代理桥错误。 */
  constructor(code: ProxyBridgeErrorCode, message: string) {
    super(message)
    this.name = "ProxyBridgeError"
    this.code = code
  }
}

/** 一个正在运行的代理桥。保证 url 只指向 127.0.0.1。 */
export type ProxyBridge = {
  url: string
  close: () => Promise<void>
}

type UpstreamProxy = {
  protocol: "http:" | "https:"
  host: string
  port: number
  auth: string | null
}

/** 启动只监听 127.0.0.1 的代理桥。保证上游只接受 HTTP/HTTPS 代理，SOCKS 明确拒绝。 */
export async function startProxyBridge(input: { upstreamProxyUrl: string }): Promise<ProxyBridge> {
  const upstream = parseUpstreamProxy(input.upstreamProxyUrl)
  const sockets = new Set<Socket>()
  const server = createServer()
  server.on("request", (request, response) => {
    handleHttp(request, response, upstream)
  })
  server.on("connect", (request, clientSocket, head) => {
    const socket = clientSocket as Socket
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    handleConnect(request, socket, head, upstream)
  })

  await listen(server)
  const address = server.address()
  if (address === null || typeof address === "string") {
    server.close()
    throw new Error("代理桥没有绑定端口")
  }

  let closed = false
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return
      closed = true
      for (const socket of sockets) socket.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

function parseUpstreamProxy(value: string): UpstreamProxy {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProxyBridgeError("INVALID_PROXY_URL", "代理地址无效")
  }
  if (url.protocol === "socks5:" || url.protocol === "socks:") {
    throw new ProxyBridgeError("UNSUPPORTED_PROXY_SCHEME", "只支持 HTTP/HTTPS 代理")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProxyBridgeError("UNSUPPORTED_PROXY_SCHEME", "只支持 HTTP/HTTPS 代理")
  }
  if (url.hostname === "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new ProxyBridgeError("INVALID_PROXY_URL", "代理地址无效")
  }
  const defaultPort = url.protocol === "https:" ? 443 : 80
  const port = url.port === "" ? defaultPort : Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProxyBridgeError("INVALID_PROXY_URL", "代理地址无效")
  }
  const auth =
    url.username === "" && url.password === ""
      ? null
      : `Basic ${Buffer.from(
          `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`,
        ).toString("base64")}`
  return { protocol: url.protocol, host: url.hostname, port, auth }
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error)
    }
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      resolve()
    })
  })
}

function handleHttp(
  request: IncomingMessage,
  response: ServerResponse,
  upstream: UpstreamProxy,
): void {
  const target = parseAbsoluteHttpUrl(request.url)
  if (target === null) {
    request.resume()
    writeStatus(response, 400)
    return
  }
  const requestFn = upstream.protocol === "https:" ? httpsRequest : httpRequest
  let upstreamRequest: ReturnType<typeof httpRequest>
  try {
    upstreamRequest = requestFn(
      {
        protocol: upstream.protocol,
        hostname: upstream.host,
        port: upstream.port,
        method: request.method,
        path: target.href,
        headers: forwardHeaders(request, target, upstream),
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.on("error", () => response.destroy())
        upstreamResponse.pipe(response)
      },
    )
  } catch {
    request.resume()
    writeStatus(response, 502)
    return
  }
  upstreamRequest.setTimeout(connectTimeoutMs, () => upstreamRequest.destroy())
  upstreamRequest.on("error", () => {
    if (!response.headersSent) writeStatus(response, 502)
    else response.destroy()
  })
  request.on("error", () => upstreamRequest.destroy())
  response.on("error", () => upstreamRequest.destroy())
  response.on("close", () => {
    if (!response.writableFinished) upstreamRequest.destroy()
  })
  request.pipe(upstreamRequest)
}

function handleConnect(
  request: IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
  upstream: UpstreamProxy,
): void {
  const target = parseAuthority(request.url)
  if (target === null) {
    writeRawStatus(clientSocket, 400)
    return
  }
  clientSocket.setTimeout(idleTimeoutMs, () => clientSocket.destroy())

  let settled = false
  let tunnelEstablished = false
  let upstreamSocket: Socket | null = null
  let pendingBytes = head.length
  const pendingChunks: Buffer[] = head.length === 0 ? [] : [head]
  const fail = (): void => {
    if (settled) return
    settled = true
    writeRawStatus(clientSocket, 502)
    upstreamSocket?.destroy()
  }
  clientSocket.once("close", () => {
    settled = true
    upstreamSocket?.destroy()
  })
  clientSocket.once("error", () => clientSocket.destroy())
  clientSocket.once("end", () => {
    if (!tunnelEstablished) clientSocket.destroy()
  })
  const onPendingData = (chunk: Buffer): void => {
    pendingBytes += chunk.length
    if (pendingBytes > maxPendingConnectBytes) {
      clientSocket.destroy()
      return
    }
    pendingChunks.push(chunk)
  }
  if (pendingBytes > maxPendingConnectBytes) {
    clientSocket.destroy()
    return
  }
  clientSocket.on("data", onPendingData)
  clientSocket.resume()

  const socket =
    upstream.protocol === "https:"
      ? tlsConnect({
          host: upstream.host,
          port: upstream.port,
          servername: isIP(upstream.host) === 0 ? upstream.host : undefined,
        })
      : netConnect({ host: upstream.host, port: upstream.port })
  upstreamSocket = socket

  socket.setTimeout(connectTimeoutMs, () => socket.destroy())
  socket.once("error", fail)
  socket.once("close", () => {
    if (!settled) fail()
    else if (tunnelEstablished) clientSocket.destroy()
  })
  socket.once(upstream.protocol === "https:" ? "secureConnect" : "connect", () => {
    if (settled || clientSocket.destroyed) {
      socket.destroy()
      return
    }
    const authorization = upstream.auth === null ? "" : `Proxy-Authorization: ${upstream.auth}\r\n`
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authorization}\r\n`)

    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      if (settled || clientSocket.destroyed) {
        socket.destroy()
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      const headerEnd = buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) {
        if (buffer.length > maxProxyHeaderBytes) fail()
        return
      }
      socket.off("data", onData)
      const statusLine = buffer.subarray(0, headerEnd).toString("latin1").split("\r\n")[0] ?? ""
      if (!/^HTTP\/1\.[01] 200\b/i.test(statusLine)) {
        fail()
        return
      }
      settled = true
      tunnelEstablished = true
      const remainder = buffer.subarray(headerEnd + 4)
      clientSocket.pause()
      clientSocket.off("data", onPendingData)
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (remainder.length > 0) clientSocket.write(remainder)
      for (const chunk of pendingChunks) socket.write(chunk)
      socket.setTimeout(idleTimeoutMs, () => socket.destroy())
      socket.pipe(clientSocket)
      clientSocket.pipe(socket)
    }
    socket.on("data", onData)
  })
}

function parseAbsoluteHttpUrl(value: string | undefined): URL | null {
  if (value === undefined) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:" || url.host === "") return null
  return url
}

function parseAuthority(value: string | undefined): string | null {
  if (value === undefined) return null
  if (value.startsWith("[")) {
    const end = value.indexOf("]")
    if (end < 0 || value[end + 1] !== ":") return null
    const port = Number(value.slice(end + 2))
    if (!validPort(port)) return null
    return value
  }
  const separator = value.lastIndexOf(":")
  if (separator <= 0) return null
  const port = Number(value.slice(separator + 1))
  if (!validPort(port)) return null
  return value
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

function forwardHeaders(
  request: IncomingMessage,
  target: URL,
  upstream: UpstreamProxy,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (name === "proxy-authorization" || name === "proxy-connection") continue
    headers[name] = value
  }
  headers.host = target.host
  if (upstream.auth !== null) headers["proxy-authorization"] = upstream.auth
  return headers
}

function writeStatus(response: ServerResponse, status: number): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" })
  response.end()
}

function writeRawStatus(socket: Socket, status: number): void {
  if (socket.destroyed) return
  const text = status === 400 ? "Bad Request" : "Bad Gateway"
  socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 0\r\n\r\n`)
}
