// 代理桥生命周期测试，覆盖浏览器断开时的请求清理和 CONNECT 提前数据。

import { once } from "node:events"
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
} from "node:http"
import { connect as netConnect, type AddressInfo, type Socket } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { startProxyBridge } from "./proxy-bridge.ts"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe("proxy bridge request lifetime", () => {
  it.each(["browser", "bridge"] as const)(
    "closes an in-flight upstream HTTP request when %s closes",
    async (source) => {
      let notifyStarted: () => void = () => undefined
      let notifyClosed: () => void = () => undefined
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve
      })
      const closed = new Promise<void>((resolve) => {
        notifyClosed = resolve
      })
      const upstream = createHttpServer((_request, response) => {
        response.once("close", notifyClosed)
        notifyStarted()
      })
      await listen(upstream)
      track(() => closeHttpServer(upstream))
      const bridge = await startProxyBridge({
        upstreamProxyUrl: `http://127.0.0.1:${portOfServer(upstream)}`,
      })
      track(bridge.close)
      const request = httpRequest({
        host: "127.0.0.1",
        port: portOf(bridge.url),
        path: "http://127.0.0.1:1/held",
      })
      request.on("error", () => undefined)
      request.end()
      await started
      if (source === "browser") request.destroy()
      else await bridge.close()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          closed,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("上游请求没有关闭")), 1_000)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
  )

  it("closes a pending CONNECT upstream when the browser disconnects", async () => {
    let notifyStarted: () => void = () => undefined
    let notifyClosed: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve
    })
    let forwarded = ""
    let lateResponseAttempted = false
    let pendingSocket: Socket | undefined
    const upstream = createHttpServer()
    upstream.on("connect", (_request, socket, head) => {
      pendingSocket = socket as Socket
      forwarded += head.toString("utf8")
      socket.on("data", (data: Buffer) => {
        forwarded += data.toString("utf8")
      })
      socket.once("end", () => {
        lateResponseAttempted = true
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        socket.end()
      })
      socket.on("error", () => undefined)
      socket.once("close", notifyClosed)
      notifyStarted()
      socket.resume()
    })
    await listen(upstream)
    track(async () => {
      pendingSocket?.destroy()
      await closeHttpServer(upstream)
    })
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://127.0.0.1:${portOfServer(upstream)}`,
    })
    track(bridge.close)
    const client = netConnect({ host: "127.0.0.1", port: portOf(bridge.url) })
    client.on("error", () => undefined)
    await once(client, "connect")
    client.write("CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\nfixture-head")
    await started
    client.destroy()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        closed,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("CONNECT 上游没有关闭")), 1_000)
        }),
      ])
      expect(lateResponseAttempted).toBe(true)
      expect(forwarded).toBe("")
    } finally {
      clearTimeout(timeout)
    }
  })

  it("closes an established CONNECT upstream when the browser disconnects", async () => {
    let notifyClosed: () => void = () => undefined
    const closed = new Promise<void>((resolve) => {
      notifyClosed = resolve
    })
    let upstreamSocket: Socket | undefined
    const upstream = createHttpServer()
    upstream.on("connect", (_request, socket) => {
      upstreamSocket = socket as Socket
      socket.once("end", () => {
        socket.end()
        notifyClosed()
      })
      socket.once("close", notifyClosed)
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      socket.resume()
    })
    await listen(upstream)
    track(async () => {
      upstreamSocket?.destroy()
      await closeHttpServer(upstream)
    })
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://127.0.0.1:${portOfServer(upstream)}`,
    })
    track(bridge.close)
    const request = httpRequest({
      method: "CONNECT",
      host: "127.0.0.1",
      port: portOf(bridge.url),
      path: "127.0.0.1:1",
    })
    request.end()
    const [response, client] = (await once(request, "connect")) as [{ statusCode: number }, Socket]
    expect(response.statusCode).toBe(200)
    client.destroy()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        closed,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("已建立的 CONNECT 上游没有关闭")), 1_000)
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
  })

  it("preserves early CONNECT data until the upstream accepts the tunnel", async () => {
    let notifyStarted: () => void = () => undefined
    let notifyForwarded: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    const forwarded = new Promise<void>((resolve) => {
      notifyForwarded = resolve
    })
    let pendingSocket: Socket | undefined
    let received = ""
    const upstream = createHttpServer()
    upstream.on("connect", (_request, socket, head) => {
      pendingSocket = socket as Socket
      received += head.toString("utf8")
      socket.on("data", (data: Buffer) => {
        received += data.toString("utf8")
        if (received.length >= "firstsecond".length) notifyForwarded()
      })
      socket.resume()
      notifyStarted()
    })
    await listen(upstream)
    track(async () => {
      pendingSocket?.destroy()
      await closeHttpServer(upstream)
    })
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://127.0.0.1:${portOfServer(upstream)}`,
    })
    track(bridge.close)
    const client = netConnect({ host: "127.0.0.1", port: portOf(bridge.url) })
    client.on("error", () => undefined)
    await once(client, "connect")
    client.write("CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\nfirst")
    await started
    client.write("second")
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(received).toBe("")
    pendingSocket?.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        forwarded,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("CONNECT 提前数据没有转发")), 1_000)
        }),
      ])
      expect(received).toBe("firstsecond")
    } finally {
      clearTimeout(timeout)
      client.destroy()
    }
  })

  it("closes a pending CONNECT when early data exceeds its bounded buffer", async () => {
    let notifyStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    let pendingSocket: Socket | undefined
    let forwarded = 0
    const upstream = createHttpServer()
    upstream.on("connect", (_request, socket, head) => {
      pendingSocket = socket as Socket
      forwarded += head.length
      socket.on("data", (data: Buffer) => {
        forwarded += data.length
      })
      socket.resume()
      notifyStarted()
    })
    await listen(upstream)
    track(async () => {
      pendingSocket?.destroy()
      await closeHttpServer(upstream)
    })
    const bridge = await startProxyBridge({
      upstreamProxyUrl: `http://127.0.0.1:${portOfServer(upstream)}`,
    })
    track(bridge.close)
    const client = netConnect({ host: "127.0.0.1", port: portOf(bridge.url) })
    client.on("error", () => undefined)
    const closed = once(client, "close")
    await once(client, "connect")
    client.write("CONNECT 127.0.0.1:1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\n\r\n")
    await started
    client.write(Buffer.alloc(1024 * 1024 + 1, 0x61))
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        closed,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("超限 CONNECT 没有关闭")), 5_000)
        }),
      ])
      expect(forwarded).toBe(0)
    } finally {
      clearTimeout(timeout)
      client.destroy()
    }
  })
})

async function listen(server: HttpServer): Promise<void> {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

function portOfServer(server: HttpServer): number {
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("server has no port")
  return (address as AddressInfo).port
}

function portOf(url: string): number {
  return Number(new URL(url).port)
}

function track(close: () => Promise<void>): void {
  cleanups.push(async () => {
    await close().catch(() => undefined)
  })
}
