// 验证真实浏览器经 Xray 访问受信任的本机 HTTPS 目标。

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { Duplex } from "node:stream"
import { chromium, errors, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const trustedTargetCertificate = process.env["PIGCLAUDE_TEST_TRUST_TARGET_CERT"] === "1"
const fixtures = resolve(
  import.meta.dirname,
  "../../../../../packages/login-gate/src/test-fixtures",
)

it.skipIf(!browserBinary || !xrayBinary || !trustedTargetCertificate)(
  "HTTPS 目标经过 Xray 和账密代理，关闭 Xray 后不能直连",
  async () => {
    const key = await readFile(join(fixtures, "loopback-ip-synthetic-key.pem"))
    const cert = await readFile(join(fixtures, "loopback-ip-synthetic-cert.pem"))
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-https-target-"))
    const sockets = new Set<Duplex>()
    const forwarded = new Set<number>()
    let viaProxy = 0
    let direct = 0
    let targetPort = 0
    const target = createHttpsServer({ key, cert }, (request, response) => {
      if (request.socket.remotePort !== undefined && forwarded.has(request.socket.remotePort)) {
        viaProxy += 1
      } else {
        direct += 1
      }
      response.setHeader("Connection", "close")
      response.end("synthetic HTTPS target")
    })
    const proxy = createHttpServer()
    target.on("connection", (socket) => track(socket, sockets))
    proxy.on("connection", (socket) => track(socket, sockets))
    proxy.on("connect", (request, socket, head) => {
      const expected = `Basic ${Buffer.from("synthetic:password").toString("base64")}`
      if (
        request.url !== `127.0.0.1:${targetPort}` ||
        request.headers["proxy-authorization"] !== expected
      ) {
        socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
        return
      }
      const forwardedSocket = connect(targetPort, "127.0.0.1", () => {
        const port = forwardedSocket.localPort
        if (port !== undefined) forwarded.add(port)
        forwardedSocket.once("close", () => {
          if (port !== undefined) forwarded.delete(port)
        })
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length > 0) forwardedSocket.write(head)
        socket.pipe(forwardedSocket).pipe(socket)
      })
      track(forwardedSocket, sockets)
      forwardedSocket.on("error", () => socket.destroy())
      socket.on("error", () => forwardedSocket.destroy())
    })
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: browserBinary,
      hostArch: process.arch,
      profilesRoot: join(directory, "profiles"),
    })
    const start = createXrayRuntimeStarter({
      binaryPath: xrayBinary,
      hostArch: process.arch,
      idleTimeoutMs: 0,
    })
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    let browser: Browser | undefined
    try {
      targetPort = await listen(target)
      const proxyPort = await listen(proxy)
      callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
      const runtime = await start({
        upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${proxyPort}`,
      })
      const launched = await adapter.launch({
        accountId: "https-target",
        authorizeUrl: `https://127.0.0.1:${targetPort}/initial`,
        network: { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
        fingerprint: {
          ...fingerprint,
          unknownArgs: ["--headless=new", "--remote-debugging-port=0", "--use-mock-keychain"],
        },
      })
      const port = await debugPort(join(launched.profileDir, "DevToolsActivePort"))
      browser = await within(chromium.connectOverCDP(`http://127.0.0.1:${port}`), 5_000)
      const context = browser.contexts()[0]
      if (context === undefined) throw new Error("浏览器上下文不可用")
      const page = await within(context.newPage(), 5_000)
      const response = await page.goto(`https://127.0.0.1:${targetPort}/before`, {
        timeout: 10_000,
      })
      expect(response?.status()).toBe(200)
      expect(viaProxy).toBeGreaterThan(0)
      expect(direct).toBe(0)
      await runtime.close()
      const previous = { viaProxy, direct }
      try {
        const failed = await page.goto(`https://127.0.0.1:${targetPort}/after`, { timeout: 5_000 })
        if (failed === null || failed.status() < 400) throw new Error("Xray 关闭后意外成功")
      } catch (error: unknown) {
        if (
          error instanceof errors.TimeoutError ||
          !(error instanceof Error) ||
          !error.message.includes("net::ERR_")
        )
          throw error
      }
      expect({ viaProxy, direct }).toEqual(previous)
    } finally {
      if (browser !== undefined) await within(browser.close(), 2_000).catch(() => undefined)
      for (const socket of sockets) socket.destroy()
      const results = await Promise.allSettled([
        adapter.dispose(),
        start.dispose(),
        callback?.close(),
        proxy.listening ? new Promise<void>((done) => proxy.close(() => done())) : undefined,
        target.listening ? new Promise<void>((done) => target.close(() => done())) : undefined,
      ])
      if (results.some((result) => result.status === "rejected")) {
        throw new Error(`测试资源未确认回收，保留临时目录 ${directory}`)
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  45_000,
)

function track(socket: Duplex, sockets: Set<Duplex>): void {
  sockets.add(socket)
  socket.once("close", () => sockets.delete(socket))
  socket.on("error", () => undefined)
}

async function listen(server: ReturnType<typeof createHttpServer>): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("合成服务未启动")
  return address.port
}

async function debugPort(path: string): Promise<number> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(path, "utf8")).split("\n")[0])
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
    } catch {
      // 等待测试浏览器写入调试端口。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error("浏览器未启动")
}

async function within<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("浏览器操作超时")), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
