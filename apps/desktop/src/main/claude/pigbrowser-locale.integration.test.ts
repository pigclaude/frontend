// 从桌面启动器验证 PigBrowser 的真实区域生命周期，使用隔离配置、本机合成页面和 Xray。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test"
import { expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { createLoopbackFixture } from "./fingerprint-chromium-loopback-fixture"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const timezone = "America/New_York"

it.skipIf(!browserBinary || !xrayBinary).each([
  ["en-SG", true],
  ["fr-CA", false],
] as const)(
  "PigBrowser %s 的首屏、iframe、扩展和后台 Worker 使用保存的区域（绑定代理：%s）",
  async (locale, bound) => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-pigbrowser-locale-"))
    const snapshot = snapshotSource()
    const fixture = await createLoopbackFixture((request, response) => {
      response.setHeader("Cache-Control", "no-store")
      if (request.url === "/worker.js") {
        response.setHeader("Content-Type", "application/javascript")
        response.end(`postMessage(${snapshot})`)
      } else if (request.url === "/shared.js") {
        response.setHeader("Content-Type", "application/javascript")
        response.end(`onconnect=e=>e.ports[0].postMessage(${snapshot})`)
      } else if (request.url === "/sw.js") {
        response.setHeader("Content-Type", "application/javascript")
        response.end(
          `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('message',e=>e.source.postMessage(${snapshot}))`,
        )
      } else {
        response.setHeader("Content-Type", "text/html")
        response.end(
          `<!doctype html><script>globalThis.initialFingerprint=${snapshot};if(parent!==self)parent.postMessage(initialFingerprint,'*')</script>`,
        )
      }
    })
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: browserBinary,
      hostArch: process.arch,
      profilesRoot: join(directory, "profiles"),
    })
    const starter = createXrayRuntimeStarter({ binaryPath: xrayBinary, hostArch: process.arch })
    let browser: Browser | undefined
    const callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
    let failure: unknown
    const cleanupErrors: unknown[] = []
    try {
      const extension = join(directory, "extension")
      await mkdir(extension)
      await writeFile(
        join(extension, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Synthetic PigBrowser Locale",
          version: "1.0",
          background: { service_worker: "background.js" },
        }),
      )
      await writeFile(join(extension, "background.js"), `globalThis.initialFingerprint=${snapshot}`)
      await writeFile(join(extension, "probe.html"), '<script src="background.js"></script>')
      const runtime = bound
        ? await starter({
            upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
          })
        : undefined
      for (const pass of [1, 2]) {
        await rm(join(adapter.profileDir("locale"), "DevToolsActivePort"), { force: true })
        const target = `http://127.0.0.1:${fixture.originPort}/probe?pass=${pass}`
        const launched = await adapter.launch({
          accountId: "locale",
          authorizeUrl: target,
          network: runtime
            ? { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri }
            : { mode: "system" },
          fingerprint: {
            ...fingerprint,
            seed: "18446744073709551615",
            lang: locale,
            timezone,
            unknownArgs: [
              "--headless=new",
              "--remote-debugging-port=0",
              "--use-mock-keychain",
              `--load-extension=${extension}`,
            ],
          },
        })
        let port = 0
        await expect
          .poll(
            async () => {
              port = Number(
                (await readFile(join(launched.profileDir, "DevToolsActivePort"), "utf8")).split(
                  "\n",
                )[0],
              )
              return port
            },
            { timeout: 5_000 },
          )
          .toBeGreaterThan(0)
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        const context = browser.contexts()[0]
        const page = context?.pages()[0]
        if (!context || !page) throw new Error("PigBrowser 授权页面不可用")
        await page.waitForURL(target)
        checkSnapshot(await page.evaluate("globalThis.initialFingerprint"), locale)
        await verifyPageLifecycle(context, page, fixture.originPort, snapshot, locale)
        const background = context
          .serviceWorkers()
          .find((worker) => worker.url().endsWith("/sw.js"))
        if (!background) throw new Error("合成后台 Worker 未启动")
        for (const tab of context.pages()) await tab.close()
        checkSnapshot(await background.evaluate(snapshot), locale)
        expect(
          await background.evaluate(
            "clients.matchAll({type:'window',includeUncontrolled:true}).then(items=>items.length)",
          ),
        ).toBe(0)
        await browser.close()
        browser = undefined
        await adapter.stop("locale")
      }
      expect(fixture.requests()[bound ? "viaProxy" : "direct"]).toBeGreaterThan(0)
      if (bound) expect(fixture.requests().direct).toBe(0)
    } catch (error: unknown) {
      failure = error
    } finally {
      if (browser) await browser.close().catch((error: unknown) => cleanupErrors.push(error))
      await adapter.dispose().catch((error: unknown) => cleanupErrors.push(error))
      const results = await Promise.allSettled([
        starter.dispose(),
        callback.close(),
        fixture.close(),
      ])
      cleanupErrors.push(
        ...results.filter((result) => result.status === "rejected").map((result) => result.reason),
      )
      if (cleanupErrors.length)
        throw new AggregateError([failure, ...cleanupErrors], `合成资源未确认回收：${directory}`)
      await rm(directory, { recursive: true, force: true })
    }
    if (failure !== undefined) throw failure
  },
  60_000,
)

it.skipIf(!browserBinary)(
  "不支持的语言在打开授权页面前明确失败",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-pigbrowser-invalid-"))
    const fixture = await createLoopbackFixture()
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: browserBinary,
      hostArch: process.arch,
      profilesRoot: directory,
    })
    try {
      await expect(
        adapter.launch({
          accountId: "invalid",
          authorizeUrl: `http://127.0.0.1:${fixture.originPort}/probe`,
          network: { mode: "system" },
          fingerprint: {
            ...fingerprint,
            lang: "zz-ZZ",
            unknownArgs: ["--headless=new", "--use-mock-keychain"],
          },
        }),
      ).rejects.toMatchObject({
        code: "BROWSER_START_FAILED",
        message: expect.stringContaining("语言"),
      })
      expect(fixture.requests()).toEqual({ viaProxy: 0, direct: 0 })
    } finally {
      await adapter.dispose()
      await fixture.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
  15_000,
)

async function verifyPageLifecycle(
  context: BrowserContext,
  page: Page,
  port: number,
  snapshot: string,
  locale: string,
): Promise<void> {
  const next = await context.newPage()
  await next.goto(`http://127.0.0.1:${port}/probe/new`)
  checkSnapshot(await next.evaluate("globalThis.initialFingerprint"), locale)
  checkSnapshot(
    await page.evaluate(`new Promise(resolve=>{
    addEventListener('message',e=>resolve(e.data),{once:true});
    const frame=document.createElement('iframe');frame.src='http://localhost:${port}/probe/frame';document.body.append(frame)
  })`),
    locale,
  )
  checkSnapshot(
    await page.evaluate(
      "new Promise(resolve=>{const worker=new Worker('/worker.js');worker.onmessage=e=>{worker.terminate();resolve(e.data)}})",
    ),
    locale,
  )
  checkSnapshot(
    await page.evaluate(
      "new Promise(resolve=>{globalThis.shared=new SharedWorker('/shared.js');shared.port.onmessage=e=>resolve(e.data);shared.port.start()})",
    ),
    locale,
  )
  await page.evaluate(
    "navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready)",
  )
  checkSnapshot(
    await page.evaluate(
      "new Promise(async resolve=>{navigator.serviceWorker.addEventListener('message',e=>resolve(e.data),{once:true});(await navigator.serviceWorker.ready).active.postMessage('snapshot')})",
    ),
    locale,
  )
  await expect
    .poll(
      () => context.serviceWorkers().filter((worker) => worker.url().endsWith("/sw.js")).length,
      {
        timeout: 5_000,
      },
    )
    .toBeGreaterThan(0)
  await expect
    .poll(
      () =>
        context.serviceWorkers().filter((worker) => worker.url().startsWith("chrome-extension://"))
          .length,
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0)
  const extension = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"))
  if (!extension) throw new Error("合成扩展 Worker 未启动")
  checkSnapshot(await extension.evaluate("globalThis.initialFingerprint"), locale)
  const extensionPage = await context.newPage()
  await extensionPage.goto(extension.url().replace("/background.js", "/probe.html"))
  checkSnapshot(await extensionPage.evaluate("globalThis.initialFingerprint"), locale)
  checkSnapshot(await page.evaluate(snapshot), locale)
}

function snapshotSource(): string {
  return `(()=>{
    const services=[Intl.DateTimeFormat,Intl.NumberFormat,Intl.Collator,Intl.PluralRules,Intl.RelativeTimeFormat,Intl.ListFormat];
    return {language:navigator.language,locales:services.map(C=>new C().resolvedOptions().locale),timezone:new Intl.DateTimeFormat().resolvedOptions().timeZone,offsets:[new Date('2026-01-15T12:00:00Z').getTimezoneOffset(),new Date('2026-07-15T12:00:00Z').getTimezoneOffset()]}
  })()`
}

function checkSnapshot(value: unknown, locale: string): void {
  expect(value).toMatchObject({ language: locale, timezone, offsets: [300, 240] })
  if (value === null || typeof value !== "object" || !("locales" in value)) {
    throw new Error("合成环境未返回 Intl 结果")
  }
  expect(value.locales).toEqual([locale, locale, locale, locale, locale, locale])
}
