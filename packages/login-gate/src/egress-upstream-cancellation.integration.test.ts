// 验证上游代理不响应 CONNECT 时，取消或超时会关闭连接并结束出口核对。

import { createServer, type Socket } from "node:net"
import { Response } from "node-fetch"
import { expect, it } from "vitest"
import { checkEgress } from "./egress-check"

it.each(["cancel", "timeout"] as const)("上游 CONNECT 等待期间发生 %s", async (mode) => {
  const sockets = new Set<Socket>()
  let observe: () => void = () => undefined
  const connected = new Promise<void>((resolve) => {
    observe = resolve
  })
  const upstream = createServer((socket) => {
    sockets.add(socket)
    socket.on("error", () => undefined)
    socket.once("close", () => sockets.delete(socket))
    socket.once("data", () => observe())
  })
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject)
    upstream.listen(0, "127.0.0.1", resolve)
  })
  const address = upstream.address()
  if (address === null || typeof address === "string") throw new Error("合成代理未监听")
  const controller = new AbortController()
  const pending = checkEgress({
    bridgeUrl: "socks5://127.0.0.1:9",
    upstreamProxyUrl: `http://127.0.0.1:${address.port}`,
    checkUrl: "https://synthetic.example.invalid/trace",
    timeoutMs: mode === "timeout" ? 500 : 10_000,
    signal: controller.signal,
    fetchSocks: async () => new Response("ip=198.51.100.42\n"),
  }).catch((error: unknown) => error)
  try {
    await connected
    if (mode === "cancel") controller.abort(new Error("合成取消"))
    const result = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve("未及时结束"), 2_000)),
    ])
    if (mode === "cancel") expect(result).toMatchObject({ message: "合成取消" })
    else expect(result).toMatchObject({ ok: false, reason: "timeout" })
    await expect.poll(() => sockets.size, { timeout: 1_000 }).toBe(0)
  } finally {
    controller.abort(new Error("测试结束"))
    const closed = new Promise<void>((resolve) => upstream.close(() => resolve()))
    for (const socket of sockets) socket.destroy()
    await Promise.allSettled([closed, pending])
  }
})
