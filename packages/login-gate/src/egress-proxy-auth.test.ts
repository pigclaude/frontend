// 验证出口核对的代理桥和 daemon 同款路径使用一致的 Basic 凭据。

import { createServer } from "node:http"
import type { Socket } from "node:net"
import { describe, expect, it } from "vitest"
import { checkEgress } from "./egress-check.ts"
import { startProxyBridge } from "./proxy-bridge.ts"

const ipBody = "ip=198.51.100.42\n"

async function startUpstream(): Promise<{
  port: number
  authorizations: Array<string | undefined>
  close: () => Promise<void>
}> {
  const server = createServer()
  const sockets = new Set<Socket>()
  const authorizations: Array<string | undefined> = []
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  server.on("connect", (request, socket) => {
    authorizations.push(request.headers["proxy-authorization"])
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    socket.once("data", () => {
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(ipBody)}\r\nConnection: close\r\n\r\n${ipBody}`,
      )
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error("测试代理未监听")
  }
  return {
    port: address.port,
    authorizations,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

describe("出口核对的代理认证", () => {
  it.each([
    { credentials: "name@", decoded: "name:" },
    { credentials: ":secret@", decoded: ":secret" },
    { credentials: "%E7%94%A8:%E5%AF%86@", decoded: "用:密" },
  ])("桥和直接上游对同一凭据发送相同认证", async ({ credentials, decoded }) => {
    const upstream = await startUpstream()
    try {
      const url = `http://${credentials}127.0.0.1:${upstream.port}`
      const bridge = await startProxyBridge({ upstreamProxyUrl: url })
      try {
        const result = await checkEgress({
          bridgeUrl: bridge.url,
          upstreamProxyUrl: url,
          checkUrl: "http://unresolvable.invalid/check",
          timeoutMs: 3_000,
        })
        expect(result).toEqual({ ok: true, ip: "198.51.100.42" })
        const expected = `Basic ${Buffer.from(decoded, "utf8").toString("base64")}`
        expect(upstream.authorizations).toEqual([expected, expected])
      } finally {
        await bridge.close()
      }
    } finally {
      await upstream.close()
    }
  })
})
