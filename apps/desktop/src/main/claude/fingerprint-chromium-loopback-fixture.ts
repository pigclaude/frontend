// 为真实浏览器代理测试提供仅转发合成目标的认证代理。

import { createServer as createHttpServer, type RequestListener } from "node:http"
import { connect, type Socket } from "node:net"

/** 创建可记录请求来源并主动断开的本机合成代理。 */
export async function createLoopbackFixture(respond?: RequestListener): Promise<{
  originPort: number
  proxyPort: number
  requests: () => { viaProxy: number; direct: number }
  rejectedCredentials: () => number
  failProxy: () => void
  close: () => Promise<void>
}> {
  let viaProxy = 0
  let direct = 0
  let rejected = 0
  let dropping = false
  const forwarded = new Set<number>()
  const sockets = new Set<Socket>()
  const origin = createHttpServer((request, response) => {
    if (request.url?.startsWith("/probe")) {
      if (request.socket.remotePort !== undefined && forwarded.has(request.socket.remotePort)) {
        viaProxy += 1
      } else {
        direct += 1
      }
    }
    response.setHeader("Connection", "close")
    if (respond) respond(request, response)
    else response.end("<!doctype html><title>synthetic</title>")
  })
  const originPort = await listen(origin)
  const proxy = createHttpServer()
  proxy.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    if (dropping) socket.destroy()
  })
  proxy.on("connect", (request, socket, head) => {
    const expected = `Basic ${Buffer.from("synthetic:password").toString("base64")}`
    if (request.headers["proxy-authorization"] !== expected) rejected += 1
    if (
      ![
        `127.0.0.1:${originPort}`,
        `localhost:${originPort}`,
        `synthetic.example.invalid:${originPort}`,
      ].includes(request.url ?? "") ||
      request.headers["proxy-authorization"] !== expected
    ) {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
      return
    }
    const target = connect(originPort, "127.0.0.1", () => {
      const port = target.localPort
      if (port !== undefined) forwarded.add(port)
      target.once("close", () => {
        if (port !== undefined) forwarded.delete(port)
      })
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length !== 0) target.write(head)
      socket.pipe(target).pipe(socket)
    })
    sockets.add(target)
    target.once("close", () => sockets.delete(target))
    target.on("error", () => socket.destroy())
    socket.on("error", () => target.destroy())
  })
  let proxyPort: number
  try {
    proxyPort = await listen(proxy)
  } catch (error: unknown) {
    origin.closeAllConnections()
    await new Promise<void>((resolve) => origin.close(() => resolve()))
    throw error
  }
  return {
    originPort,
    proxyPort,
    requests: () => ({ viaProxy, direct }),
    rejectedCredentials: () => rejected,
    failProxy: () => {
      dropping = true
      for (const socket of sockets) socket.destroy()
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      origin.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve) => origin.close(() => resolve())),
        new Promise<void>((resolve) => proxy.close(() => resolve())),
      ])
    },
  }
}

async function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("合成服务未监听")
  return address.port
}
