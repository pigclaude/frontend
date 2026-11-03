// 验证真实 OAuth 客户端在 SOCKS 握手或响应读取中取消时关闭连接。

import { createServer, type Socket } from "node:net"
import { expect, it } from "vitest"
import { createHarness, fingerprint, type Harness } from "./account-service-test-fixtures"
import { SubscriptionOAuth } from "./subscription-oauth"

it.each(["handshake", "body"] as const)(
  "取消正在进行的 OAuth %s 请求",
  async (phase) => {
    const sockets = new Set<Socket>()
    let notify: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      notify = resolve
    })
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      socket.on("error", () => undefined)
      let state = 0
      let data = Buffer.alloc(0)
      socket.on("data", (chunk: Buffer) => {
        data = Buffer.concat([data, chunk])
        if (state === 0 && data.length >= 2 && data.length >= 2 + (data[1] ?? 0)) {
          data = data.subarray(2 + (data[1] ?? 0))
          if (phase === "handshake") {
            notify()
            return
          }
          state = 1
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
        if (state === 1 && size > 0 && data.length >= size) {
          data = data.subarray(size)
          state = 2
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
        }
        if (state === 2 && data.includes("\r\n\r\n")) {
          state = 3
          socket.write(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{",
          )
          notify()
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("SOCKS 夹具未监听")
    const client = new SubscriptionOAuth({
      tokenUrl: "http://synthetic.example.invalid/token",
      timeoutMs: 10_000,
    })
    let harness: Harness | undefined
    try {
      harness = await createHarness({
        bridgeUrl: `socks5://127.0.0.1:${address.port}`,
        oauth: {
          buildAuthorizeUrl: () => "https://synthetic.invalid/authorize",
          startCallback: async () => ({
            redirectUri: "http://localhost:1234/callback",
            isComplete: () => true,
            waitForCode: async () => "code",
            cancel: () => undefined,
            close: async () => undefined,
          }),
          exchangeCode: (input) => client.exchangeCode(input),
          readProfile: (input) => client.readProfile(input),
        },
      })
      const authorization = harness.service
        .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
        .catch((error: unknown) => error)
      await started
      await harness.service.cancel()
      expect(await authorization).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
      await expect.poll(() => sockets.size, { timeout: 1_000 }).toBe(0)
      expect(await harness.store.getAccount("acc-1")).toBeNull()
    } finally {
      for (const socket of sockets) socket.destroy()
      const cleanup = await Promise.allSettled([
        harness?.cleanup(),
        new Promise<void>((resolve) => server.close(() => resolve())),
      ])
      if (cleanup.some((result) => result.status === "rejected"))
        throw new Error("OAuth 测试资源未全部回收")
    }
  },
  5_000,
)
