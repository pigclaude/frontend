// 验证真实浏览器经 Xray 和受信任的合成 HTTPS 代理访问 HTTPS 页面。

import { mkdtemp, readFile, rm } from "node:fs/promises"
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
const trustedProxyCertificate = process.env["PIGCLAUDE_TEST_TRUST_PROXY_CERT"] === "1"
const fixtures = resolve(
  import.meta.dirname,
  "../../../../../packages/login-gate/src/test-fixtures",
)
const certPath = join(fixtures, "loopback-ip-synthetic-cert.pem")

it.skipIf(!browserBinary || !xrayBinary || !trustedProxyCertificate)(
  "HTTPS 上游代理和 HTTPS 页面经过 Xray，关闭 Xray 后请求失败",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-https-proxy-"))
    const key = await readFile(join(fixtures, "loopback-ip-synthetic-key.pem"))
    const cert = await readFile(certPath)
    const proxy = createHttpsServer({ key, cert })
    const sockets = new Set<Duplex>()
    let accepted = 0
    let tlsReady = 0
    let tlsFailure = ""
    proxy.on("connection", (socket) => track(socket, sockets))
    proxy.on("secureConnection", () => {
      tlsReady += 1
    })
    proxy.on("tlsClientError", (error) => {
      if (tlsFailure === "") tlsFailure = error.message
    })
    proxy.on("connect", (request, socket, head) => {
      const expected = `Basic ${Buffer.from("synthetic:password").toString("base64")}`
      if (
        request.url !== "example.com:443" ||
        request.headers["proxy-authorization"] !== expected
      ) {
        socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
        return
      }
      accepted += 1
      const target = connect(443, "example.com", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length > 0) target.write(head)
        socket.pipe(target).pipe(socket)
      })
      track(target, sockets)
      target.on("error", () => socket.destroy())
      socket.on("error", () => target.destroy())
    })
    const callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
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
    const previousCertFile = process.env["SSL_CERT_FILE"]
    process.env["SSL_CERT_FILE"] = certPath
    let browser: Browser | undefined
    try {
      await new Promise<void>((resolveListen, reject) => {
        proxy.once("error", reject)
        proxy.listen(0, "127.0.0.1", resolveListen)
      })
      const address = proxy.address()
      if (address === null || typeof address === "string") throw new Error("HTTPS 代理未启动")
      const runtime = await start({
        upstreamProxyUrl: `https://synthetic:password@127.0.0.1:${address.port}`,
      })
      const launched = await adapter.launch({
        accountId: "https-proxy",
        authorizeUrl: "https://example.com/",
        network: { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
        fingerprint: {
          ...fingerprint,
          unknownArgs: ["--headless=new", "--remote-debugging-port=0", "--use-mock-keychain"],
        },
      })
      const port = await debugPort(join(launched.profileDir, "DevToolsActivePort"))
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      const context = browser.contexts()[0]
      if (context === undefined) throw new Error("浏览器上下文不可用")
      const page = await context.newPage()
      const response = await page
        .goto("https://example.com/?pigclaude=1", { timeout: 15_000 })
        .catch((error: unknown) => {
          throw new Error(
            `HTTPS 请求失败；上游 TLS 连接 ${tlsReady}，代理认证通过 ${accepted}，TLS 错误 ${tlsFailure}`,
            { cause: error },
          )
        })
      expect(response?.status()).toBe(200)
      expect(accepted).toBeGreaterThan(0)
      await runtime.close()
      try {
        const failed = await page.goto("https://example.com/?pigclaude=2", { timeout: 10_000 })
        if (failed === null || failed.status() < 400) throw new Error("Xray 关闭后意外成功")
      } catch (error: unknown) {
        if (
          error instanceof errors.TimeoutError ||
          !(error instanceof Error) ||
          !error.message.includes("net::ERR_")
        )
          throw error
      }
    } finally {
      await browser?.close().catch(() => undefined)
      for (const socket of sockets) socket.destroy()
      const results = await Promise.allSettled([
        adapter.dispose(),
        start.dispose(),
        callback.close(),
        proxy.listening
          ? new Promise<void>((resolveClose) => proxy.close(() => resolveClose()))
          : undefined,
      ])
      if (previousCertFile === undefined) delete process.env["SSL_CERT_FILE"]
      else process.env["SSL_CERT_FILE"] = previousCertFile
      if (results.some((result) => result.status === "rejected")) {
        throw new Error(`测试资源未确认回收，保留临时目录 ${directory}`)
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  60_000,
)

function track(socket: Duplex, sockets: Set<Duplex>): void {
  sockets.add(socket)
  socket.once("close", () => sockets.delete(socket))
  socket.on("error", () => undefined)
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
