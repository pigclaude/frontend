// 验证 Xray HTTP 客户端只接受本机 SOCKS5 入口和 HTTP(S) 请求地址。

import { createServer, type Socket } from "node:net"
import { expect, it } from "vitest"
import { createXrayHttpClient } from "./xray-http"

it.each([
  "http://127.0.0.1:9000",
  "socks5://example.test:9000",
  "socks5://127.0.0.1:0",
  "socks5://127.0.0.1:65536",
  "socks5://user@127.0.0.1:9000",
  "socks5://127.0.0.1:9000/path",
])("拒绝无效的 Xray 入口 %s", (bridgeUrl) => {
  expect(() => createXrayHttpClient(bridgeUrl)).toThrow("Xray 入口地址无效")
})

it.each(["data:text/plain,synthetic", "file:///tmp/synthetic", "http://user@localhost/"])(
  "拒绝不受支持的请求地址 %s",
  async (url) => {
    const client = createXrayHttpClient("socks5://127.0.0.1:9")
    try {
      await expect(
        client.request(url, { method: "GET", headers: {}, signal: AbortSignal.timeout(1_000) }),
      ).rejects.toThrow("Xray 请求地址无效")
    } finally {
      client.close()
    }
  },
)

it.each(["abort", "close"] as const)(
  "%s 时关闭尚未完成的 SOCKS 握手",
  async (action) => {
    const sockets = new Set<Socket>()
    let receivedGreeting: () => void = () => undefined
    const greeting = new Promise<void>((resolve) => {
      receivedGreeting = resolve
    })
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      socket.on("error", () => undefined)
      socket.once("data", () => receivedGreeting())
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("SOCKS 夹具未监听")
    const controller = new AbortController()
    const client = createXrayHttpClient(`socks5://127.0.0.1:${address.port}`)
    const deadline = setTimeout(() => controller.abort(), 3_000)
    try {
      const pending = client.request("http://synthetic.example.invalid/", {
        method: "GET",
        headers: {},
        signal: controller.signal,
      })
      await greeting
      if (action === "abort") controller.abort()
      else client.close()
      await expect(pending).rejects.toThrow()
      if (action === "close") expect(controller.signal.aborted).toBe(false)
      await expect.poll(() => sockets.size, { timeout: 2_000 }).toBe(0)
    } finally {
      clearTimeout(deadline)
      client.close()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  },
  5_000,
)
