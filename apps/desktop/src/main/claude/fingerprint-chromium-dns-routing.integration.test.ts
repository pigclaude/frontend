// 使用预构建浏览器和真实 Xray 验证域名经代理传递及代理关闭后不直连。
import { randomBytes } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, errors, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createProxyFixture } from "./xray-egress-fixture"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(!browserBinary || !xrayBinary)(
  "域名原样到达上游代理，Xray 停止后不直接访问目标",
  async () => {
    const host = `dns-${randomBytes(8).toString("hex")}.invalid`
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-dns-route-"))
    const fixture = await createProxyFixture("user@test:p:ss", host)
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: browserBinary,
      hostArch: process.arch,
      profilesRoot: join(directory, "profiles"),
    })
    const starter = createXrayRuntimeStarter({
      binaryPath: xrayBinary,
      hostArch: process.arch,
      idleTimeoutMs: 0,
    })
    let browser: Browser | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    let runtime: Awaited<ReturnType<typeof starter>> | undefined
    let failure: unknown
    try {
      callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
      runtime = await starter({
        upstreamProxyUrl: `http://user%40test:p%3Ass@127.0.0.1:${fixture.proxyPort}`,
      })
      const launched = await adapter.launch({
        accountId: "domain-probe",
        authorizeUrl: `http://${host}:${fixture.targetPort}/initial`,
        network: { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
        fingerprint: {
          ...fingerprint,
          unknownArgs: ["--headless=new", "--remote-debugging-port=0", "--use-mock-keychain"],
        },
      })
      const port = await debugPort(join(launched.profileDir, "DevToolsActivePort"))
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5_000 })
      const context = browser.contexts()[0]
      if (!context) throw new Error("浏览器上下文不可用")
      const page = context.pages()[0] ?? (await context.newPage())
      const response = await page.goto(`http://${host}:${fixture.targetPort}/before`, {
        timeout: 10_000,
      })
      expect(response?.status()).toBe(200)
      expect(fixture.accepted()).toBeGreaterThan(0)
      expect(fixture.directRequests()).toBe(0)
      await runtime.close()
      const before = fixture.targetRequests()
      try {
        const after = await page.goto(`http://${host}:${fixture.targetPort}/after`, {
          timeout: 5_000,
        })
        if (after === null || after.status() < 400) throw new Error("Xray 停止后意外访问成功")
      } catch (error: unknown) {
        if (
          error instanceof errors.TimeoutError ||
          !(error instanceof Error) ||
          !error.message.includes("net::ERR_")
        )
          throw error
      }
      expect(fixture.targetRequests()).toBe(before)
      expect(fixture.directRequests()).toBe(0)
    } catch (error: unknown) {
      failure = error
    } finally {
      const cleanupErrors: unknown[] = []
      if (browser)
        await within(browser.close(), 5_000).catch((error: unknown) => cleanupErrors.push(error))
      await adapter.dispose().catch((error: unknown) => cleanupErrors.push(error))
      const results = await Promise.allSettled([
        runtime?.close(),
        starter.dispose(),
        callback?.close(),
        fixture.close(),
      ])
      cleanupErrors.push(
        ...results.filter((result) => result.status === "rejected").map((result) => result.reason),
      )
      if (cleanupErrors.length)
        throw new AggregateError([failure, ...cleanupErrors], `测试资源未确认回收：${directory}`)
      if (failure) throw failure
      await rm(directory, { recursive: true, force: true })
    }
  },
  45_000,
)

async function debugPort(file: string): Promise<number> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(file, "utf8")).split("\n")[0])
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
    } catch {
      /* 等待浏览器写入调试端口。 */
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("浏览器调试端口未就绪")
}

async function within<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("浏览器关闭超时")), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
