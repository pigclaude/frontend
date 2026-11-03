// 使用用户提供的 HTTP 上游代理验证真实浏览器和 Xray 链路，不输出代理凭据或出口地址。

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkEgress, parseExitIp } from "@pigclaude/login-gate/egress-check"
import { chromium, errors, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const enabled = process.env["PIGCLAUDE_TEST_LIVE_HTTP_PROXY"] === "1"
const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const traceUrl = "https://www.cloudflare.com/cdn-cgi/trace"

it.skipIf(!enabled)(
  "使用真实 HTTP 上游代理完成 HTTPS 出口核对、浏览器访问和失效阻断",
  async () => {
    const proxyUrl = process.env["PIGCLAUDE_TEST_HTTP_PROXY_URL"]?.trim()
    delete process.env["PIGCLAUDE_TEST_HTTP_PROXY_URL"]
    if (!browserBinary || !xrayBinary || !proxyUrl) throw new Error("缺少真实代理测试所需资源")
    try {
      if (new URL(proxyUrl).protocol !== "http:") throw new Error("代理协议无效")
    } catch {
      throw new Error("测试代理必须是有效的 HTTP 代理 URL")
    }
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-live-http-proxy-"))
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
    let runtime: Awaited<ReturnType<typeof start>> | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    let browser: Browser | undefined
    let stage = "启动 Xray"
    let reason = ""
    try {
      runtime = await start({ upstreamProxyUrl: proxyUrl })
      stage = "核对 Xray 与上游代理出口"
      const egress = await checkEgress({
        bridgeUrl: runtime.url,
        upstreamProxyUrl: proxyUrl,
        checkUrl: traceUrl,
        timeoutMs: 15_000,
      })
      if (!egress.ok) {
        reason = egress.reason
        throw new Error("出口核对未通过")
      }
      stage = "启动授权浏览器"
      callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
      const launched = await adapter.launch({
        accountId: "live-http-proxy",
        authorizeUrl: traceUrl,
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
      stage = "浏览器经 HTTP 上游代理访问 HTTPS 目标"
      const response = await page.goto(`${traceUrl}?pigclaude=before`, { timeout: 20_000 })
      if (response === null || !response.ok()) throw new Error("目标访问失败")
      const browserIp = parseExitIp(await page.locator("body").innerText())
      if (browserIp === null || browserIp !== egress.ip) {
        reason = "mismatch"
        throw new Error("浏览器出口不一致")
      }
      stage = "Xray 关闭后阻断目标访问"
      await runtime.close()
      try {
        await page.goto(`${traceUrl}?pigclaude=after`, { timeout: 10_000 })
        throw new Error("代理关闭后目标返回了响应")
      } catch (error: unknown) {
        if (
          error instanceof errors.TimeoutError ||
          !(error instanceof Error) ||
          !error.message.includes("net::ERR_")
        )
          throw error
      }
      stage = "Xray 关闭后接收授权回调"
      const callbackUrl = new URL(callback.redirectUri)
      callbackUrl.searchParams.set("state", "synthetic")
      callbackUrl.searchParams.set("code", "synthetic-code")
      const callbackPage = await within(context.newPage(), 5_000)
      await callbackPage.goto(callbackUrl.href, { timeout: 5_000 })
      await expect(callback.waitForCode()).resolves.toBe("synthetic-code")
    } catch {
      throw new Error(`真实 HTTP 上游代理验证失败：${stage}${reason ? `（${reason}）` : ""}`)
    } finally {
      if (browser !== undefined) await within(browser.close(), 2_000).catch(() => undefined)
      await adapter.dispose().catch(() => {
        throw new Error("真实 HTTP 上游代理测试浏览器未确认退出")
      })
      const results = await Promise.allSettled([
        runtime?.close(),
        start.dispose(),
        callback?.close(),
      ])
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("真实 HTTP 上游代理测试资源未确认回收")
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  100_000,
)

async function debugPort(path: string): Promise<number> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(path, "utf8")).split("\n")[0])
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
    } catch {
      // 等待测试浏览器写入调试端口。
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("浏览器未就绪")
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
