// 验证授权回调后 Xray 退出时，令牌交换不会绕开 Xray 访问绑定的上游代理。

import { createServer, type Server } from "node:http"
import { connect, createServer as createNetServer } from "node:net"
import type { Duplex } from "node:stream"
import { expect, it } from "vitest"
import { createHarness, fingerprint, type Harness } from "./account-service-test-fixtures"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const binary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(!binary).each(["before-token", "after-token"] as const)(
  "授权阶段 %s Xray 退出，不保存账号",
  async (phase) => {
    const sockets = new Set<Duplex>()
    const track = (socket: Duplex) => {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
      socket.on("error", () => undefined)
    }
    let targetRequests = 0
    let upstreamRequests = 0
    let replacementConnections = 0
    const replacement = createNetServer((socket) => {
      replacementConnections += 1
      socket.destroy()
    })
    const target = createServer((request, response) => {
      targetRequests += 1
      const body =
        request.url === "/token"
          ? { access_token: "synthetic", refresh_token: "synthetic", expires_in: 60 }
          : { account: { uuid: "synthetic" } }
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(body))
    })
    target.on("connection", track)
    const targetPort = await listen(target)
    const upstream = createServer()
    upstream.on("connection", track)
    upstream.on("connect", (_request, downstream) => {
      upstreamRequests += 1
      const socket = connect(targetPort, "127.0.0.1")
      track(socket)
      socket.once("connect", () => {
        downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        downstream.pipe(socket)
        socket.pipe(downstream)
      })
      socket.once("error", () => downstream.destroy())
    })
    let upstreamPort: number
    try {
      upstreamPort = await listen(upstream)
    } catch (error: unknown) {
      await close(target)
      throw error
    }
    const start = createXrayRuntimeStarter({ binaryPath: binary, hostArch: process.arch })
    let harness: Harness | undefined
    try {
      const proxyUrl = `http://127.0.0.1:${upstreamPort}`
      const runtime = await start({ upstreamProxyUrl: proxyUrl })
      const client = new SubscriptionOAuth({
        tokenUrl: `http://127.0.0.1:${targetPort}/token`,
        profileUrl: `http://127.0.0.1:${targetPort}/profile`,
        timeoutMs: 3_000,
      })
      harness = await createHarness({
        bridgeUrl: runtime.url,
        proxyRuntime: runtime,
        oauth: {
          buildAuthorizeUrl: () => "https://synthetic.invalid/authorize",
          startCallback: async () => ({
            redirectUri: "http://localhost:1234/callback",
            waitForCode: async () => {
              if (phase === "before-token") {
                await runtime.close()
                await new Promise<void>((resolve, reject) => {
                  replacement.once("error", reject)
                  replacement.listen(Number(new URL(runtime.url).port), "127.0.0.1", resolve)
                })
              }
              return "synthetic-code"
            },
            cancel: () => undefined,
            close: async () => undefined,
          }),
          exchangeCode: async (input) => {
            const tokens = await client.exchangeCode(input)
            if (phase === "after-token") await runtime.close()
            return tokens
          },
          readProfile: (input) => client.readProfile(input),
        },
      })
      await harness.store.saveProxy({
        schemaVersion: 1,
        id: "p1",
        name: "synthetic",
        url: proxyUrl,
        lastTest: null,
      })
      await expect(
        harness.service.authorize({ displayName: "合成账号", proxyId: "p1", fingerprint }),
      ).rejects.toMatchObject({
        code: "PROXY_UNAVAILABLE",
      })
      expect(upstreamRequests).toBe(phase === "before-token" ? 0 : 1)
      expect(targetRequests).toBe(phase === "before-token" ? 0 : 1)
      expect(replacementConnections).toBe(0)
      expect(await harness.store.getAccount("acc-1")).toBeNull()
    } finally {
      for (const socket of sockets) socket.destroy()
      const cleanup = await Promise.allSettled([
        start.dispose(),
        harness?.cleanup(),
        close(target),
        close(upstream),
        replacement.listening
          ? new Promise<void>((resolve) => replacement.close(() => resolve()))
          : undefined,
      ])
      if (cleanup.some((result) => result.status === "rejected")) {
        throw new Error("Xray 授权测试资源未全部回收")
      }
    }
  },
  15_000,
)

it.skipIf(!binary)("回调服务启动期间 Xray 退出时不启动浏览器", async () => {
  const start = createXrayRuntimeStarter({ binaryPath: binary, hostArch: process.arch })
  let harness: Harness | undefined
  let release: () => void = () => undefined
  let observe: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    observe = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:9" })
    harness = await createHarness({
      proxyRuntime: runtime,
      callbackStartWait: async () => {
        observe()
        await gate
      },
    })
    const authorization = harness.service
      .authorize({ displayName: "合成账号", proxyId: "p1", fingerprint })
      .catch((error: unknown) => error)
    await entered
    await runtime.close()
    release()
    expect(await authorization).toMatchObject({ code: "PROXY_UNAVAILABLE" })
    expect(harness.browserCalls).not.toContain("launch")
  } finally {
    release()
    const cleanup = await Promise.allSettled([start.dispose(), harness?.cleanup()])
    if (cleanup.some((result) => result.status === "rejected"))
      throw new Error("Xray 测试资源未全部回收")
  }
})

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("测试服务未监听")
  return address.port
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
