// 使用实际 PigBrowser/Xray 验证浏览器报告；native 后端为明确合成端口，真实后端另由授权集成覆盖。

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import type { EnvironmentCheckReport } from "./environment-check-model"
import { openAuthorizedPage } from "./browser-startup"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { createLoopbackFixture } from "./fingerprint-chromium-loopback-fixture"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"
import { syntheticNativeEvidence } from "./environment-check-test-fixtures"

const binary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xray = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const authorization = "https://claude.test/oauth/authorize?state=synthetic-private-state"

it.skipIf(!binary || !xray)(
  "实际内核完成自检后显示本机报告，等待用户继续授权",
  async () => {
    await withEnvironmentBrowser(async ({ page, report, requests }) => {
      expect(await page.title()).toBe("PigClaude 授权环境自检")
      await expect.poll(() => report()?.verdict).toBe("passed")
      expect(await page.locator("main").getAttribute("data-verdict")).toBe("passed")
      expect(await page.locator("form").getAttribute("action")).toBe(
        "https://claude.test/oauth/authorize",
      )
      expect(await page.locator('input[name="state"]').inputValue()).toBe("synthetic-private-state")
      expect(await page.locator("body").textContent()).not.toContain("CheckCC")
      expect(requests().direct).toBe(0)
      expect(requests().viaProxy).toBeGreaterThanOrEqual(3)
      const exported: unknown = await page.evaluate(`(async()=>{
      let text;URL.createObjectURL=blob=>{text=blob.text();return "blob:synthetic"};
      HTMLAnchorElement.prototype.click=function(){};
      document.getElementById("export").click();return await text;
    })()`)
      expect(exported).toEqual(expect.any(String))
      expect(exported).not.toContain("1.1.1.1")
      expect(exported).not.toContain("synthetic-private-state")
      expect(exported).not.toContain("socks5://")
      expect(exported).not.toContain("binding")
    })
  },
  90_000,
)

it.skipIf(!binary || !xray).each([
  { secondaryIp: "8.8.8.8", expected: "blocked", checkId: "exit" },
  { secondaryIp: "192.168.1.1", expected: "incomplete", checkId: "exit" },
  { secondaryIp: "invalid-provider-body", expected: "incomplete", checkId: "exit" },
  { languageOverride: "fr-FR", expected: "blocked", checkId: "settings" },
  { challenge: true, expected: "incomplete", checkId: "claude-navigation" },
  { challenge200: true, expected: "incomplete", checkId: "claude-navigation" },
  { dnsInvalid: true, expected: "incomplete", checkId: "proxy-dns" },
])(
  "实际采样异常 $checkId/$expected 时不暴露授权参数",
  async (options) => {
    await withEnvironmentBrowser(async ({ page, report }) => {
      expect(report()?.verdict).toBe(options.expected)
      expect(report()?.checks.find((item) => item.id === options.checkId)?.state).not.toBe("passed")
      expect(await page.locator("form").count()).toBe(0)
      const html = await page.content()
      expect(html).not.toContain("synthetic-private-state")
      expect(html).not.toContain("claude.test/oauth/authorize")
    }, options)
  },
  90_000,
)

it.skipIf(!binary || !xray)(
  "大型正常公开登录页不受出口探针正文上限影响",
  async () => {
    await withEnvironmentBrowser(
      async ({ report }) => {
        expect(report()?.verdict).toBe("passed")
      },
      { largeLogin: true },
    )
  },
  90_000,
)

it.skipIf(!binary || !xray)(
  "公开页面超过五秒才挂载控件时仍等待同一文档完成",
  async () => {
    await withEnvironmentBrowser(
      async ({ report }) => {
        expect(report()?.verdict).toBe("passed")
      },
      { delayedLogin: true },
    )
  },
  90_000,
)

it.skipIf(!binary || !xray)(
  "脚本跳转后的登录 DOM 不能借用前一文档的 native 响应放行",
  async () => {
    await withEnvironmentBrowser(
      async ({ page, report }) => {
        expect(report()?.verdict).not.toBe("passed")
        expect(report()?.checks.find((item) => item.id === "claude-navigation")?.state).not.toBe(
          "passed",
        )
        expect(await page.locator("form").count()).toBe(0)
      },
      { redirectedLogin: true },
    )
  },
  90_000,
)

it.skipIf(!binary || !xray)(
  "系统网络记录自动配置基线，不要求应用内代理证据",
  async () => {
    await withEnvironmentBrowser(
      async ({ report, requests }) => {
        expect(report()?.verdict).toBe("passed")
        expect(report()?.networkMode).toBe("system")
        expect(report()?.checks.find((item) => item.id === "proxy-route")?.state).toBe("info")
        expect(report()?.checks.find((item) => item.id === "webrtc")?.critical).toBe(false)
        expect(requests().direct).toBeGreaterThanOrEqual(3)
        expect(requests().viaProxy).toBe(0)
      },
      { system: true },
    )
  },
  90_000,
)

async function withEnvironmentBrowser(
  check: (input: {
    page: import("@playwright/test").Page
    report: () => EnvironmentCheckReport | undefined
    requests: () => { direct: number; viaProxy: number }
  }) => Promise<void>,
  options: {
    secondaryIp?: string
    challenge?: boolean
    languageOverride?: string
    system?: boolean
    delayedLogin?: boolean
    redirectedLogin?: boolean
    challenge200?: boolean
    largeLogin?: boolean
    dnsInvalid?: boolean
  } = {},
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-environment-check-"))
  const fixture = await createLoopbackFixture((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    if (request.url?.includes("/dns")) {
      response.setHeader("Content-Type", "application/dns-json")
      response.end(
        JSON.stringify(
          options.dnsInvalid
            ? {
                Status: 0,
                Question: [{ name: "wrong.example", type: 1 }],
                Answer: [{ type: 1, data: "192.168.1.1" }],
              }
            : {
                Status: 0,
                Question: [{ name: "example.com.", type: 1 }],
                Answer: [{ type: 1, data: "1.1.1.1" }],
              },
        ),
      )
    } else if (request.url?.includes("/moved")) {
      response.setHeader("Content-Type", "text/html")
      response.end('<!doctype html><input type="email">')
    } else if (request.url?.includes("/login")) {
      response.setHeader("Content-Type", "text/html")
      if (options.challenge) {
        response.statusCode = 403
        response.setHeader("cf-mitigated", "challenge")
        response.end("<!doctype html><title>Just a moment</title>")
      } else if (options.largeLogin) {
        response.end(`<!doctype html><input type="email"><!--${"x".repeat(70_000)}-->`)
      } else if (options.challenge200) {
        response.setHeader("cf-mitigated", "challenge")
        response.end('<!doctype html><input type="email">')
      } else if (options.delayedLogin) {
        response.end(
          '<!doctype html><title>Synthetic login</title><script>setTimeout(()=>document.body.appendChild(Object.assign(document.createElement("input"),{type:"email"})),6000)</script>',
        )
      } else if (options.redirectedLogin) {
        response.end(
          `<!doctype html><script>window.onload=()=>location.replace("http://localhost:${fixture.originPort}/probe/moved")</script>`,
        )
      } else response.end('<!doctype html><title>Synthetic login</title><input type="email">')
    } else {
      response.setHeader("Content-Type", "application/json")
      response.end(
        JSON.stringify({
          ip: request.url?.includes("secondary") ? (options.secondaryIp ?? "1.1.1.1") : "1.1.1.1",
          country_code: "US",
          asn: 6079,
        }),
      )
    }
  })
  const targets = {
    primaryIp: `http://127.0.0.1:${fixture.originPort}/probe/primary`,
    secondaryIp: `http://127.0.0.1:${fixture.originPort}/probe/secondary`,
    claudeLogin: `http://127.0.0.1:${fixture.originPort}/probe/login`,
    stun: "stun:stun.cloudflare.com:3478",
    dnsQuery: `http://127.0.0.1:${fixture.originPort}/probe/dns`,
  }
  let startupFailure: unknown
  const adapter = new FingerprintChromiumAdapter({
    binaryPath: binary,
    hostArch: process.arch,
    profilesRoot: join(directory, "profiles"),
    openPage: async (input) => {
      try {
        await openAuthorizedPage({ ...input, environmentTargets: targets })
      } catch (error: unknown) {
        startupFailure = error
        throw error
      }
    },
  })
  const start = createXrayRuntimeStarter({ binaryPath: xray, hostArch: process.arch })
  const callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
  let browser: Browser | undefined
  let report: EnvironmentCheckReport | undefined
  let failure: unknown
  const cleanupErrors: unknown[] = []
  try {
    const runtime = await start({
      upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
    })
    const launched = await adapter.launch({
      accountId: "environment-test",
      authorizeUrl: authorization,
      network: options.system
        ? { mode: "system" }
        : { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
      fingerprint: {
        ...fingerprint,
        ...(options.system ? { lang: "", timezone: "", acceptLang: "", platform: "" } : {}),
        unknownArgs: [
          "--headless=new",
          "--remote-debugging-port=0",
          "--use-mock-keychain",
          ...(options.languageOverride ? [`--lang=${options.languageOverride}`] : []),
        ],
      },
      environmentCheck: {
        runId: "synthetic-environment-run",
        startedAt: Date.now(),
        expectedExitIp: "1.1.1.1",
        nativeEvidence: syntheticNativeEvidence(
          Date.now(),
          options.system ? "system" : "bound",
          "1.1.1.1",
        ),
        onReport: (next) => {
          report = next
        },
      },
    })
    const port = Number(
      (await readFile(join(launched.profileDir, "DevToolsActivePort"), "utf8")).split("\n")[0],
    )
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = browser.contexts()[0]?.pages()[0]
    if (!page) throw new Error("本机自检报告没有显示")
    await check({ page, report: () => report, requests: fixture.requests })
  } catch (error: unknown) {
    failure = startupFailure ?? error
  } finally {
    if (browser) await browser.close().catch((error: unknown) => cleanupErrors.push(error))
    await adapter.dispose().catch((error: unknown) => cleanupErrors.push(error))
    const results = await Promise.allSettled([start.dispose(), callback.close(), fixture.close()])
    cleanupErrors.push(...results.filter((r) => r.status === "rejected").map((r) => r.reason))
    if (cleanupErrors.length)
      throw new AggregateError([failure, ...cleanupErrors], `未确认清理：${directory}`)
    await rm(directory, { recursive: true, force: true })
  }
  if (failure !== undefined) throw failure
}
