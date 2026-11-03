// 为 Xray 出口测试提供合成代理与目标服务，区分代理流量和直接请求。

import { createServer as createHttpServer } from "node:http"
import { connect, type Socket } from "node:net"

/** 启动带认证的合成代理和目标服务，记录实际经过代理的请求。 */
export async function createProxyFixture(credentials = "user@test:p:ss"): Promise<{
  targetPort: number
  proxyPort: number
  accepted: () => number
  targetRequests: () => number
  directRequests: () => number
  failProxy: () => void
  onTarget: (callback: (count: number) => Promise<void>) => void
  close: () => Promise<void>
}> {
  let accepted = 0
  let targetRequests = 0
  let directRequests = 0
  let dropping = false
  let onTarget: (count: number) => Promise<void> = async () => undefined
  const sockets = new Set<Socket>()
  const forwarded = new Set<number>()
  const target = createHttpServer((request, response) => {
    targetRequests += 1
    if (request.socket.remotePort === undefined || !forwarded.has(request.socket.remotePort)) {
      directRequests += 1
    }
    void onTarget(targetRequests).then(() => {
      if (request.url === "/redirect") response.writeHead(302, { location: "/trace" }).end()
      else if (
        request.url === "/redirect-data-first" ||
        (request.url === "/redirect-data-second" && targetRequests === 2)
      ) {
        response.writeHead(302, { location: "data:text/plain,ip%3D198.51.100.42" }).end()
      } else response.end("ip=198.51.100.42\n")
    })
  })
  const targetPort = await listen(target)
  const proxy = createHttpServer()
  proxy.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    if (dropping) socket.destroy()
  })
  proxy.on("connect", (request, socket, head) => {
    const expected = `Basic ${Buffer.from(credentials).toString("base64")}`
    if (
      request.url !== `127.0.0.1:${targetPort}` ||
      request.headers["proxy-authorization"] !== expected
    ) {
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nConnection: close\r\n\r\n")
      return
    }
    const upstream = connect(targetPort, "127.0.0.1", () => {
      const port = upstream.localPort
      if (port !== undefined) forwarded.add(port)
      upstream.once("close", () => {
        if (port !== undefined) forwarded.delete(port)
      })
      accepted += 1
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length !== 0) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    sockets.add(upstream)
    upstream.on("close", () => sockets.delete(upstream))
    upstream.on("error", () => socket.destroy())
    socket.on("error", () => upstream.destroy())
  })
  const proxyPort = await listen(proxy)
  return {
    targetPort,
    proxyPort,
    accepted: () => accepted,
    targetRequests: () => targetRequests,
    directRequests: () => directRequests,
    onTarget: (callback) => {
      onTarget = callback
    },
    failProxy: () => {
      dropping = true
      for (const socket of sockets) socket.destroy()
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      target.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve) => target.close(() => resolve())),
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
