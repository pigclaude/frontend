// 用真实浏览器、Xray 与本机合成代理验证受限回环路由及真实授权回调。

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { chromium, errors, type Browser, type Page } from "@playwright/test"
import { expect, it } from "vitest"
import { createLoopbackFixture } from "./fingerprint-chromium-loopback-fixture"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { findTestXrayProcess } from "./xray-process-test-utils"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(!browserBinary || !xrayBinary)(
  "真实浏览器保留扩展与回调，并在代理失效时拒绝其他回环页面",
  async () => {
    if (!browserBinary || !xrayBinary) throw new Error("缺少合成测试二进制")
    const { directory, fixture, callback } = await createTestEnvironment()
    const watchdogs: ChildProcess[] = []
    const capture = ((command: string, args: string[], options: SpawnOptions) => {
      const child = spawn(command, args, options)
      watchdogs.push(child)
      return child
    }) as typeof spawn
    const start = createXrayRuntimeStarter({
      idleTimeoutMs: 0,
      binaryPath: xrayBinary,
      hostArch: process.arch,
      spawn: capture,
    })
    const adapter = new FingerprintChromiumAdapter({
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
      const firstFingerprint = await readFingerprint(launched.page)
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
      expect(await readFingerprint(launched.page)).toEqual(firstFingerprint)
      const context = browser.contexts()[0]
      if (context === undefined) throw new Error("合成浏览器上下文不可用")
      const remoteNamePage = await context.newPage()
      await remoteNamePage.goto(
        `http://synthetic.example.invalid:${fixture.originPort}/probe-domain`,
      )
      await remoteNamePage.close()
      const watchdogPid = watchdogs[0]?.pid
      if (!watchdogPid) throw new Error("未找到本次 Xray 守护进程")
      process.kill(findTestXrayProcess(watchdogPid, xrayBinary), "SIGKILL")
      await expect
        .poll(
          () => {
            try {
              if (watchdogs.length < 2) return false
              runtime?.assertRunning?.()
              return true
            } catch {
              return false
            }
          },
          { timeout: 8_000 },
        )
        .toBe(true)
      const recovered = await context.newPage()
      await recovered.goto(`http://127.0.0.1:${fixture.originPort}/probe-recovered`)
      await recovered.close()
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

async function readFingerprint(page: Page): Promise<{
  userAgent: string
  platform: string
  language: string
  timezone: string
}> {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }))
}

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
  fixture: Awaited<ReturnType<typeof createLoopbackFixture>>
  callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>>
}> {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-real-loopback-"))
  let fixture: Awaited<ReturnType<typeof createLoopbackFixture>> | undefined
  try {
    fixture = await createLoopbackFixture()
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
