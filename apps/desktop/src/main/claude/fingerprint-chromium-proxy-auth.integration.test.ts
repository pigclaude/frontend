// 验证真实浏览器绑定错误代理账密时不能直连本机目标。

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, errors, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import { createLoopbackFixture } from "./fingerprint-chromium-loopback-fixture"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(!browserBinary || !xrayBinary)(
  "代理账密错误时浏览器不能访问本机目标",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-proxy-auth-"))
    const fixture = await createLoopbackFixture()
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
    let browser: Browser | undefined
    try {
      const runtime = await start({
        upstreamProxyUrl: `http://synthetic:wrong@127.0.0.1:${fixture.proxyPort}`,
      })
      const callbackUrl = new URL(callback.redirectUri)
      callbackUrl.searchParams.set("state", "synthetic")
      callbackUrl.searchParams.set("code", "code")
      const launched = await adapter.launch({
        accountId: "invalid-proxy",
        authorizeUrl: callbackUrl.href,
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
      const before = fixture.requests()
      try {
        const response = await page.goto(`http://127.0.0.1:${fixture.originPort}/probe-invalid`, {
          timeout: 5_000,
        })
        if (response === null || response.status() < 400) throw new Error("错误代理账密意外成功")
      } catch (error: unknown) {
        if (
          error instanceof errors.TimeoutError ||
          !(error instanceof Error) ||
          !error.message.includes("net::ERR_")
        )
          throw error
      }
      await expect.poll(() => fixture.rejectedCredentials(), { timeout: 5_000 }).toBeGreaterThan(0)
      expect(fixture.requests()).toEqual(before)
    } finally {
      await browser?.close().catch(() => undefined)
      const results = await Promise.allSettled([
        adapter.dispose(),
        start.dispose(),
        callback.close(),
        fixture.close(),
      ])
      if (results.some((result) => result.status === "rejected")) {
        throw new Error(`测试资源未确认回收，保留临时目录 ${directory}`)
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
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
  throw new Error("浏览器未启动")
}
