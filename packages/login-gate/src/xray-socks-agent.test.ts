// 验证 Xray SOCKS 客户端保留 IPv6 地址类型和 HTTPS 证书校验；证书仅供测试。

import { readFile } from "node:fs/promises"
import type { ClientRequest } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { connect, createServer, type Server, type Socket } from "node:net"
import { join } from "node:path"
import { TLSSocket } from "node:tls"
import { expect, it } from "vitest"
import { createXrayHttpClient } from "./xray-http"
import { XraySocksAgent } from "./xray-socks-agent"

it("IPv6 地址按 SOCKS5 IPv6 类型发送", async () => {
  let addressType: number | undefined
  const bridge = createServer((socket) => {
    let phase = 0
    let data = Buffer.alloc(0)
    socket.on("error", () => undefined)
    socket.on("data", (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      if (phase === 0 && data.length >= 2 && data.length >= 2 + (data[1] ?? 0)) {
        data = data.subarray(2 + (data[1] ?? 0))
        phase = 1
        socket.write(Buffer.from([5, 0]))
      }
      if (phase === 1 && data.length >= 4) {
        addressType = data[3]
        phase = 2
        socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
      }
    })
  })
  const port = await listen(bridge)
  const client = createXrayHttpClient(`socks5://127.0.0.1:${port}`)
  try {
    await expect(
      client.request("http://[::1]:12345/", {
        method: "GET",
        headers: {},
        signal: AbortSignal.timeout(3_000),
      }),
    ).rejects.toThrow()
    expect(addressType).toBe(4)
  } finally {
    client.close()
    await close(bridge)
  }
})

it("HTTPS 验证证书的目标域名或 IP，IP 不发送 SNI", async () => {
  const fixture = join(import.meta.dirname, "test-fixtures")
  const [key, cert, ipKey, ipCert] = await Promise.all([
    readFile(join(fixture, "localhost-synthetic-key.pem"), "utf8"),
    readFile(join(fixture, "localhost-synthetic-cert.pem"), "utf8"),
    readFile(join(fixture, "loopback-ip-synthetic-key.pem"), "utf8"),
    readFile(join(fixture, "loopback-ip-synthetic-cert.pem"), "utf8"),
  ])
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", () => undefined)
  }
  let servername: string | false | undefined
  let secureConnections = 0
  const target = createHttpsServer({ key, cert })
  target.on("connection", track)
  target.on("secureConnection", (socket) => {
    servername = socket.servername
    secureConnections += 1
  })
  target.on("tlsClientError", () => undefined)
  let bridge: Server | undefined
  try {
    const targetPort = await listen(target)
    let bridges = 0
    bridge = createServer((socket) => {
      bridges += 1
      track(socket)
      let phase = 0
      let data = Buffer.alloc(0)
      socket.on("data", (chunk: Buffer) => {
        if (phase === 2) return
        data = Buffer.concat([data, chunk])
        if (phase === 0 && data.length >= 2 && data.length >= 2 + (data[1] ?? 0)) {
          data = data.subarray(2 + (data[1] ?? 0))
          phase = 1
          socket.write(Buffer.from([5, 0]))
        }
        const size =
          data[3] === 1
            ? 10
            : data[3] === 4
              ? 22
              : data[3] === 3 && data.length >= 5
                ? 7 + (data[4] ?? 0)
                : 0
        if (phase === 1 && size > 0 && data.length >= size) {
          const remaining = data.subarray(size)
          phase = 2
          const upstream = connect(targetPort, "127.0.0.1")
          track(upstream)
          upstream.once("connect", () => {
            socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
            if (remaining.length > 0) upstream.write(remaining)
            socket.pipe(upstream).pipe(socket)
          })
        }
      })
    })
    const bridgePort = await listen(bridge)
    const handshake = async (host: string, ca?: string) => {
      const agent = new XraySocksAgent(bridgePort, AbortSignal.timeout(3_000))
      let socket: Socket | undefined
      const before = secureConnections
      try {
        socket = await agent.connect({} as ClientRequest, {
          secureEndpoint: true,
          host,
          port: targetPort,
          ...(ca === undefined ? {} : { ca }),
        })
        if (!(socket instanceof TLSSocket)) throw new Error("未建立 TLS 连接")
        await new Promise<void>((resolve, reject) => {
          socket?.once("secureConnect", resolve)
          socket?.once("error", reject)
        })
        expect(socket.authorized).toBe(true)
        await expect.poll(() => secureConnections).toBeGreaterThan(before)
      } finally {
        socket?.destroy()
        agent.destroy()
      }
    }
    await expect(handshake("localhost")).rejects.toThrow()
    await handshake("localhost", cert)
    await expect.poll(() => servername).toBe("localhost")
    await expect(handshake("127.0.0.1", cert)).rejects.toThrow()
    await expect(handshake("::1", cert)).rejects.toThrow()
    target.setSecureContext({ key: ipKey, cert: ipCert })
    await handshake("127.0.0.1", ipCert)
    await expect.poll(() => servername).toBe(false)
    await handshake("::1", ipCert)
    await expect(handshake("192.0.2.1", ipCert)).rejects.toThrow()
    expect(bridges).toBe(7)
  } finally {
    for (const socket of sockets) socket.destroy()
    await Promise.all([bridge && close(bridge), close(target)])
  }
}, 15_000)

async function listen(server: Server | ReturnType<typeof createHttpsServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("测试服务未监听")
  return address.port
}

async function close(server: Server | ReturnType<typeof createHttpsServer>): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
