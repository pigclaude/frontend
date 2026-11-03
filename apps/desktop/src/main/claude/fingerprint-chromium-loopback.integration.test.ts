// 用真实浏览器、Xray 与本机合成代理验证受限回环路由及真实授权回调。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import { connect, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { chromium, errors, type Browser, type Page } from "@playwright/test"
import { expect, it } from "vitest"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

class SyntheticProtectedBrowser extends FingerprintChromiumAdapter {
  /** 仅为隔离测试放行合成启动，不声明真实浏览器具备代理强制能力。 */
  override ensureBoundProxyProtection(): void {}
}

it.skipIf(!browserBinary || !xrayBinary)(
  "真实浏览器保留扩展与回调，并在代理失效时拒绝其他回环页面",
  async () => {
    if (!browserBinary || !xrayBinary) throw new Error("缺少合成测试二进制")
    const { directory, fixture, callback } = await createTestEnvironment()
    const start = createXrayRuntimeStarter({ binaryPath: xrayBinary, hostArch: process.arch })
    const adapter = new SyntheticProtectedBrowser({
      binaryPath: browserBinary,
      hostArch: process.arch,
      profilesRoot: join(directory, "profiles"),
    })
    let runtime: Awaited<ReturnType<typeof start>> | undefined
    let browser: Browser | undefined
    let browserPid: number | null = null
    let browserStopped = false
    let gracefulShutdown = true
    let testFailure: unknown = null
    try {
      const extension = join(directory, "extension")
      await mkdir(extension, { recursive: true })
      await writeFile(
        join(extension, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Synthetic Loopback Extension",
          version: "1.0",
          content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["content.js"] }],
        }),
      )
      await writeFile(
        join(extension, "content.js"),
        'document.documentElement.setAttribute("data-synthetic-extension", "ready")',
      )
      runtime = await start({
        upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
      })
      expect(runtime.url).toMatch(/^socks5:\/\/127\.0\.0\.1:\d+$/)
      const fingerprint: ClaudeFingerprintView = {
        seed: "42",
        brand: "Chrome",
        platform: "macos",
        lang: "en-US",
        timezone: "UTC",
        canvasNoise: "",
        clientRectsNoise: "",
        unknownArgs: [
          `--load-extension=${extension}`,
          "--remote-debugging-port=0",
          "--headless=new",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-default-apps",
          "--use-mock-keychain",
        ],
      }
      const launch = async (): Promise<{ browser: Browser; page: Page; pid: number | null }> => {
        await rm(join(adapter.profileDir("synthetic"), "DevToolsActivePort"), { force: true })
        const startedBrowser = await adapter.launch({
          accountId: "synthetic",
          authorizeUrl: `http://127.0.0.1:${fixture.originPort}/probe`,
          network: {
            mode: "bound",
            bridgeUrl: runtime?.url ?? "",
            callbackUri: callback.redirectUri,
          },
          fingerprint,
        })
        gracefulShutdown = false
        const port = await waitForDebugPort(
          join(adapter.profileDir("synthetic"), "DevToolsActivePort"),
        )
        const connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        try {
          const context = connection.contexts()[0]
          if (context === undefined) throw new Error("合成浏览器上下文不可用")
          const page = context.pages()[0] ?? (await context.newPage())
          await expect
            .poll(() => page.locator("html").getAttribute("data-synthetic-extension"), {
              timeout: 10_000,
            })
            .toBe("ready")
          return { browser: connection, page, pid: startedBrowser.pid }
        } catch (error: unknown) {
          await disconnectBrowser(connection)
          throw error
        }
      }
      let launched = await launch()
      browser = launched.browser
      browserPid = launched.pid
      await launched.page.evaluate(() => localStorage.setItem("synthetic", "kept"))
      if (!(await closeBrowser(browser, adapter, browserPid))) {
        throw new Error("首次合成浏览器未确认正常关闭")
      }
      gracefulShutdown = true
      browser = undefined
      browserPid = null
      launched = await launch()
      browser = launched.browser
      browserPid = launched.pid
      expect(await launched.page.evaluate(() => localStorage.getItem("synthetic"))).toBe("kept")
      const context = browser.contexts()[0]
      if (context === undefined) throw new Error("合成浏览器上下文不可用")
      const remoteNamePage = await context.newPage()
      await remoteNamePage.goto(
        `http://synthetic.example.invalid:${fixture.originPort}/probe-domain`,
      )
      await remoteNamePage.close()
      const before = fixture.requests()
      fixture.failProxy()
      for (const phase of ["upstream-down", "xray-down"]) {
        if (phase === "xray-down") await runtime.close()
        for (const host of ["127.0.0.1", "localhost"]) {
          const blockedPage = await context.newPage()
          let status: number | undefined
          try {
            const response = await blockedPage.goto(
              `http://${host}:${fixture.originPort}/probe-${phase}`,
              { timeout: 5_000 },
            )
            status = response?.status()
            if (status === undefined) throw new Error("代理断开后的导航没有明确响应")
          } catch (error: unknown) {
            if (
              error instanceof errors.TimeoutError ||
              !(error instanceof Error) ||
              !error.message.includes("net::ERR_")
            ) {
              throw error
            }
          } finally {
            await blockedPage.close()
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
          expect(fixture.requests()).toEqual(before)
          if (status !== undefined) expect(status).toBeGreaterThanOrEqual(400)
        }
      }
      expect(before.viaProxy).toBeGreaterThanOrEqual(2)
      expect(before.direct).toBe(0)
      const callbackPage = await context.newPage()
      const callbackUrl = new URL(callback.redirectUri)
      callbackUrl.searchParams.set("state", "synthetic-state")
      callbackUrl.searchParams.set("code", "synthetic-code")
      await callbackPage.goto(callbackUrl.href, { timeout: 5_000 })
      await expect(callback.waitForCode()).resolves.toBe("synthetic-code")
    } catch (error: unknown) {
      testFailure = error
    } finally {
      const failures: unknown[] = []
      if (browser !== undefined) {
        try {
          gracefulShutdown = await closeBrowser(browser, adapter, browserPid)
          if (!gracefulShutdown) failures.push(new Error("浏览器未确认正常退出"))
        } catch (error: unknown) {
          failures.push(error)
        }
      }
      try {
        await adapter.dispose()
        browserStopped = true
      } catch (error: unknown) {
        failures.push(error)
      }
      const cleanup = await Promise.allSettled([
        runtime?.close(),
        start.dispose(),
        callback.close(),
        fixture.close(),
      ])
      for (const result of cleanup) if (result.status === "rejected") failures.push(result.reason)
      if (browserStopped && gracefulShutdown && failures.length === 0) {
        await rm(directory, { recursive: true, force: true })
      } else {
        if (testFailure !== null) failures.unshift(testFailure)
        throw new AggregateError(failures, `合成资源未确认回收；临时目录保留在 ${directory}`)
      }
    }
    if (testFailure !== null) throw testFailure
  },
  45_000,
)

async function closeBrowser(
  browser: Browser,
  adapter: FingerprintChromiumAdapter,
  pid: number | null,
): Promise<boolean> {
  let graceful = false
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      graceful = await Promise.race([
        (async () => {
          const session = await browser.newBrowserCDPSession()
          await session.send("Browser.close")
          return true
        })().catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 2_000)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    if (graceful) graceful = await waitForProcessExit(pid)
  } finally {
    try {
      await adapter.stop("synthetic")
    } finally {
      if (!(await disconnectBrowser(browser))) graceful = false
    }
  }
  return graceful
}

async function disconnectBrowser(browser: Browser): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      browser.close().then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2_000)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function waitForProcessExit(pid: number | null): Promise<boolean> {
  if (pid === null) return false
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return true
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

async function createTestEnvironment(): Promise<{
  directory: string
  fixture: Awaited<ReturnType<typeof createFixture>>
  callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>>
}> {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-real-loopback-"))
  let fixture: Awaited<ReturnType<typeof createFixture>> | undefined
  try {
    fixture = await createFixture()
    const callback = await new SubscriptionOAuth().startCallback({
      state: "synthetic-state",
      timeoutMs: 60_000,
    })
    return { directory, fixture, callback }
  } catch (error: unknown) {
    await fixture?.close()
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function waitForDebugPort(path: string): Promise<number> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(path, "utf8")).split("\n")[0])
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
    } catch {
      // 进程仍在创建本轮调试端口。
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("合成浏览器未就绪")
}

async function createFixture(): Promise<{
  originPort: number
  proxyPort: number
  requests: () => { viaProxy: number; direct: number }
  failProxy: () => void
  close: () => Promise<void>
}> {
  let viaProxy = 0
  let direct = 0
  let dropping = false
  const forwarded = new Set<number>()
  const sockets = new Set<Socket>()
  const origin = createHttpServer((request, response) => {
    if (request.url?.startsWith("/probe")) {
      if (request.socket.remotePort !== undefined && forwarded.has(request.socket.remotePort)) {
        viaProxy += 1
      } else {
        direct += 1
      }
    }
    response.setHeader("Connection", "close")
    response.end("<!doctype html><title>synthetic</title>")
  })
  const originPort = await listen(origin)
  const proxy = createHttpServer()
  proxy.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    if (dropping) socket.destroy()
  })
  proxy.on("connect", (request, socket, head) => {
    const expected = `Basic ${Buffer.from("synthetic:password").toString("base64")}`
    if (
      ![`127.0.0.1:${originPort}`, `synthetic.example.invalid:${originPort}`].includes(
        request.url ?? "",
      ) ||
      request.headers["proxy-authorization"] !== expected
    ) {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
      return
    }
    const target = connect(originPort, "127.0.0.1", () => {
      const port = target.localPort
      if (port !== undefined) forwarded.add(port)
      target.once("close", () => {
        if (port !== undefined) forwarded.delete(port)
      })
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length !== 0) target.write(head)
      socket.pipe(target).pipe(socket)
    })
    sockets.add(target)
    target.once("close", () => sockets.delete(target))
    target.on("error", () => socket.destroy())
    socket.on("error", () => target.destroy())
  })
  let proxyPort: number
  try {
    proxyPort = await listen(proxy)
  } catch (error: unknown) {
    origin.closeAllConnections()
    await new Promise<void>((resolve) => origin.close(() => resolve()))
    throw error
  }
  return {
    originPort,
    proxyPort,
    requests: () => ({ viaProxy, direct }),
    failProxy: () => {
      dropping = true
      for (const socket of sockets) socket.destroy()
    },
    close: async () => {
      for (const socket of sockets) socket.destroy()
      origin.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve) => origin.close(() => resolve())),
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
