// 用预构建浏览器和 Xray 验证扩展在首次目标页面加载时已经生效。

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { fingerprint } from "./account-service-test-fixtures"
import { createLoopbackFixture } from "./fingerprint-chromium-loopback-fixture"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]
const extensionCount = 24

it.skipIf(!browserBinary || !xrayBinary)(
  "多个扩展在通过 Xray 打开的首次目标页面生效",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-extension-startup-"))
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
    let fixture: Awaited<ReturnType<typeof createLoopbackFixture>> | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    let browser: Browser | undefined
    try {
      const extensions: string[] = []
      for (let index = 0; index < extensionCount; index += 1) {
        const extension = join(directory, `extension-${index}`)
        extensions.push(extension)
        await mkdir(extension)
        await writeFile(
          join(extension, "manifest.json"),
          JSON.stringify({
            manifest_version: 3,
            name: `Synthetic Extension ${index}`,
            version: "1.0",
            content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["content.js"] }],
          }),
        )
        await writeFile(
          join(extension, "content.js"),
          `document.documentElement.setAttribute("data-synthetic-${index}", "ready")`,
        )
      }
      fixture = await createLoopbackFixture()
      callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
      const runtime = await start({
        upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
      })
      const target = `http://127.0.0.1:${fixture.originPort}/probe`
      const launched = await adapter.launch({
        accountId: "extension-startup",
        authorizeUrl: target,
        network: { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
        fingerprint: {
          ...fingerprint,
          unknownArgs: [
            `--load-extension=${extensions.join(",")}`,
            "--headless=new",
            "--remote-debugging-port=0",
            "--use-mock-keychain",
          ],
        },
      })
      const port = await debugPort(join(launched.profileDir, "DevToolsActivePort"))
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5_000 })
      const page = browser.contexts()[0]?.pages()[0]
      if (page === undefined) throw new Error("首次目标页面不可用")
      await page.waitForURL(target, { timeout: 10_000 })
      await expect
        .poll(
          async () => {
            const values = await Promise.all(
              Array.from({ length: extensionCount }, (_, index) =>
                page.locator("html").getAttribute(`data-synthetic-${index}`),
              ),
            )
            return values.filter((value) => value === "ready").length
          },
          { timeout: 10_000 },
        )
        .toBe(extensionCount)
      if (process.platform === "win32") {
        const context = browser.contexts()[0]
        if (context === undefined) throw new Error("合成浏览器上下文不可用")
        const registry = await within(context.newPage(), 5_000)
        try {
          await registry.goto("chrome://extensions/", { timeout: 10_000 })
          const paths: unknown = await within(
            registry.evaluate(
              '(async()=>{const list=await chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true});return list.filter(item=>item.name==="Synthetic Extension 0").map(item=>item.path)})()',
            ),
            5_000,
          )
          if (!Array.isArray(paths) || typeof paths[0] !== "string") {
            throw new Error("未找到合成扩展路径")
          }
          const expected = await within(realpath(extensions[0] ?? ""), 5_000)
          const actual = await within(realpath(paths[0]), 5_000)
          expect(actual.toLowerCase()).toBe(expected.toLowerCase())
          const shortForm = paths[0].toLowerCase() !== expected.toLowerCase()
          process.stdout.write(`合成扩展报告路径与真实路径不同：${shortForm}\n`)
        } finally {
          await within(registry.close(), 2_000)
        }
      }
      expect(fixture.requests()).toEqual({ viaProxy: 1, direct: 0 })
    } finally {
      await cleanupTest({ directory, adapter, start, browser, callback, fixture })
    }
  },
  45_000,
)

it.skipIf(!browserBinary || !xrayBinary)(
  "保存的扩展参数在重启后重新生效且 profile 数据保留",
  async () => {
    if (!browserBinary) throw new Error("缺少合成测试浏览器")
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-extension-persisted-"))
    const extension = join(directory, "extension")
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
    let fixture: Awaited<ReturnType<typeof createLoopbackFixture>> | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    let browser: Browser | undefined
    try {
      await mkdir(extension)
      await writeFile(
        join(extension, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Synthetic Persisted Extension",
          version: "1.0",
          content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["content.js"] }],
        }),
      )
      await writeFile(
        join(extension, "content.js"),
        'document.documentElement.setAttribute("data-synthetic-persisted", "ready")',
      )
      fixture = await createLoopbackFixture()
      callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
      const runtime = await start({
        upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
      })
      const target = `http://127.0.0.1:${fixture.originPort}/probe`
      for (const pass of [1, 2]) {
        const launched = await adapter.launch({
          accountId: "persisted",
          authorizeUrl: target,
          network: { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
          fingerprint: {
            ...fingerprint,
            unknownArgs: [
              `--load-extension=${extension}`,
              "--headless=new",
              "--remote-debugging-port=0",
              "--use-mock-keychain",
            ],
          },
        })
        const port = await debugPort(join(launched.profileDir, "DevToolsActivePort"))
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5_000 })
        const page = browser.contexts()[0]?.pages()[0]
        if (page === undefined) throw new Error("首次目标页面不可用")
        await page.waitForURL(target, { timeout: 10_000 })
        await expect
          .poll(() => page.locator("html").getAttribute("data-synthetic-persisted"), {
            timeout: 10_000,
          })
          .toBe("ready")
        if (pass === 1) {
          await page.evaluate(() => localStorage.setItem("synthetic-persisted", "saved"))
        } else {
          expect(await page.evaluate(() => localStorage.getItem("synthetic-persisted"))).toBe(
            "saved",
          )
        }
        await browser.close()
        browser = undefined
        await adapter.stop("persisted")
      }
      expect(fixture.requests()).toEqual({ viaProxy: 2, direct: 0 })
    } finally {
      await cleanupTest({ directory, adapter, start, browser, callback, fixture })
    }
  },
  45_000,
)

it.skipIf(!browserBinary || !xrayBinary)(
  "明确指定的扩展无法加载时不打开目标页面",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-extension-invalid-"))
    const extension = join(directory, "extension")
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
    let fixture: Awaited<ReturnType<typeof createLoopbackFixture>> | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    try {
      await mkdir(extension)
      await writeFile(join(extension, "manifest.json"), "{")
      fixture = await createLoopbackFixture()
      callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
      const runtime = await start({
        upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
      })
      await expect(
        adapter.launch({
          accountId: "invalid-extension",
          authorizeUrl: `http://127.0.0.1:${fixture.originPort}/probe`,
          network: { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
          fingerprint: {
            ...fingerprint,
            unknownArgs: [`--load-extension=${extension}`, "--headless=new", "--use-mock-keychain"],
          },
        }),
      ).rejects.toMatchObject({ code: "BROWSER_START_FAILED", message: "读取扩展状态超时" })
      expect(fixture.requests()).toEqual({ viaProxy: 0, direct: 0 })
    } finally {
      await cleanupTest({ directory, adapter, start, callback, fixture })
    }
  },
  45_000,
)

async function cleanupTest(input: {
  directory: string
  adapter: FingerprintChromiumAdapter
  start: ReturnType<typeof createXrayRuntimeStarter>
  browser?: Browser | undefined
  callback?: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
  fixture?: Awaited<ReturnType<typeof createLoopbackFixture>> | undefined
}): Promise<void> {
  let disconnectError: unknown
  if (input.browser !== undefined) {
    try {
      await within(input.browser.close(), 2_000)
    } catch (error: unknown) {
      disconnectError = error
    }
  }
  try {
    await input.adapter.dispose()
  } catch (error: unknown) {
    throw new Error(`浏览器未确认退出，保留合成资源 ${input.directory}`, { cause: error })
  }
  const results = await Promise.allSettled([
    input.start.dispose(),
    input.callback?.close(),
    input.fixture?.close(),
  ])
  if (results.some((result) => result.status === "rejected")) {
    throw new Error(`测试资源未确认回收，保留临时目录 ${input.directory}`)
  }
  await rm(input.directory, { recursive: true, force: true })
  if (disconnectError !== undefined) {
    throw new Error("未确认调试连接关闭", { cause: disconnectError })
  }
}

async function debugPort(path: string): Promise<number> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const port = Number((await readFile(path, "utf8")).split("\n")[0])
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
    } catch {
      // 等待本次合成浏览器创建调试端口。
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("合成浏览器未就绪")
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
