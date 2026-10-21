// 代理桥测试。覆盖 CONNECT 隧道、上游 Basic 认证、HTTP 转发、SOCKS 拒绝和关闭端口。

import { once } from "node:events"
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingHttpHeaders,
} from "node:http"
import {
  connect as netConnect,
  createServer as createNetServer,
  type AddressInfo,
  type Server as NetServer,
  type Socket,
} from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { ProxyBridgeError, startProxyBridge } from "./proxy-bridge.ts"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe("proxy bridge", () => {
  it("tunnels CONNECT through the upstream proxy with basic auth", async () => {
    const echo = await startTcpEcho()
    const upstream = await startForwardProxy()
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://user:pass@127.0.0.1:${upstream.port}`,
    })
    track(bridge.close)
    const bridgePort = portOf(bridge.url)

    const request = httpRequest({
      method: "CONNECT",
      host: "127.0.0.1",
      port: bridgePort,
      path: `127.0.0.1:${echo.port}`,
    })
    request.end()
    const [response, socket] = (await once(request, "connect")) as [{ statusCode: number }, Socket]
    expect(response.statusCode).toBe(200)
    socket.write("ping")
    const [chunk] = (await once(socket, "data")) as [Buffer]
    expect(chunk.toString("utf8")).toBe("ping")
    socket.destroy()
    expect(upstream.seenAuth[0]).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`)
  })

  it("forwards absolute HTTP requests through the upstream proxy", async () => {
    const target = await startHttpTarget()
    const upstream = await startForwardProxy()
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://127.0.0.1:${upstream.port}`,
    })
    track(bridge.close)
    const bridgePort = portOf(bridge.url)

    const body = await new Promise<string>((resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: bridgePort,
          path: `http://127.0.0.1:${target.port}/hello`,
          headers: { host: `127.0.0.1:${target.port}` },
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on("data", (chunk: Buffer) => chunks.push(chunk))
          response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
        },
      )
      request.on("error", reject)
      request.end()
    })
    expect(body).toBe("ok")
    expect(upstream.seenAuth).toEqual([""])
  })

  it("rejects SOCKS upstreams instead of silently going direct", async () => {
    await expect(
      startProxyBridge({ upstreamProxyUrl: "socks5://127.0.0.1:1080" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_PROXY_SCHEME" })
    await expect(
      startProxyBridge({ upstreamProxyUrl: "socks5://127.0.0.1:1080" }),
    ).rejects.toBeInstanceOf(ProxyBridgeError)
  })

  it("returns a bad gateway when the upstream proxy is unavailable", async () => {
    const closed = await closedPort()
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://127.0.0.1:${closed}`,
    })
    track(bridge.close)
    const request = httpRequest({
      method: "CONNECT",
      host: "127.0.0.1",
      port: portOf(bridge.url),
      path: "127.0.0.1:443",
    })
    request.end()
    const [response] = (await once(request, "connect")) as [{ statusCode: number }]
    expect(response.statusCode).toBe(502)
  })

  it("only listens on loopback and releases the port after close", async () => {
    const upstream = await startForwardProxy()
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://127.0.0.1:${upstream.port}`,
    })
    expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const bridgePort = portOf(bridge.url)
    await bridge.close()
    await expect(connectTo(bridgePort)).rejects.toBeTruthy()
  })
})

async function startTcpEcho(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createNetServer((socket) => {
    socket.pipe(socket)
  })
  await listen(server)
  track(() => closeNetServer(server))
  return { port: portOfServer(server), close: () => closeNetServer(server) }
}

async function startHttpTarget(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createHttpServer((_request, response) => {
    response.end("ok")
  })
  await listen(server)
  track(() => closeHttpServer(server))
  return { port: portOfServer(server), close: () => closeHttpServer(server) }
}

async function startForwardProxy(): Promise<{
  port: number
  seenAuth: string[]
  close: () => Promise<void>
}> {
  const seenAuth: string[] = []
  const server = createHttpServer()
  server.on("connect", (request, clientSocket, head) => {
    seenAuth.push(authOf(request.headers))
    const target = authority(request.url)
    if (target === null) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
      return
    }
    const upstream = netConnect({ host: target.host, port: target.port }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on("error", () => clientSocket.destroy())
    clientSocket.on("error", () => upstream.destroy())
  })
  server.on("request", (request, response) => {
    seenAuth.push(authOf(request.headers))
    let target: URL
    try {
      target = new URL(request.url ?? "")
    } catch {
      response.writeHead(400)
      response.end()
      return
    }
    const upstream = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      },
    )
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    request.pipe(upstream)
  })
  await listen(server)
  track(() => closeHttpServer(server))
  return { port: portOfServer(server), seenAuth, close: () => closeHttpServer(server) }
}

function authOf(headers: IncomingHttpHeaders): string {
  const value = headers["proxy-authorization"]
  return typeof value === "string" ? value : ""
}

function authority(value: string | undefined): { host: string; port: number } | null {
  if (value === undefined) return null
  const separator = value.lastIndexOf(":")
  if (separator <= 0) return null
  const port = Number(value.slice(separator + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  return { host: value.slice(0, separator).replace(/^\[|\]$/g, ""), port }
}

async function listen(server: NetServer | HttpServer): Promise<void> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
}

async function closeNetServer(server: NetServer): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
}

function portOfServer(server: NetServer | HttpServer): number {
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server has no port")
  return (address as AddressInfo).port
}

function portOf(url: string): number {
  return Number(new URL(url).port)
}

async function closedPort(): Promise<number> {
  const server = createNetServer()
  await listen(server)
  const port = portOfServer(server)
  await closeNetServer(server)
  return port
}

async function connectTo(port: number): Promise<void> {
  const socket = netConnect({ host: "127.0.0.1", port })
  await once(socket, "connect")
  socket.destroy()
}

function track(close: () => Promise<void>): void {
  cleanups.push(async () => {
    await close().catch(() => undefined)
  })
}
