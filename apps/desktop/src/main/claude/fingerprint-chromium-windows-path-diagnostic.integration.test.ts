// 在隔离的 Windows 运行器中比较合成扩展的目录与浏览器返回的目录。

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

const binary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xray = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(process.platform !== "win32" || !binary || !xray)(
  "比较合成扩展目录",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-win-ext-diagnostic-"))
    const extension = join(directory, "extension")
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: binary,
      hostArch: process.arch,
      profilesRoot: join(directory, "profiles"),
    })
    const start = createXrayRuntimeStarter({
      binaryPath: xray,
      hostArch: process.arch,
      idleTimeoutMs: 0,
    })
    const controller = new AbortController()
    let fixture: Awaited<ReturnType<typeof createLoopbackFixture>> | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    let connection: Browser | undefined
    let launching: Promise<unknown> | undefined
    try {
      await mkdir(extension)
      await writeFile(
        join(extension, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Synthetic Path Diagnostic",
          version: "1.0",
          content_scripts: [{ matches: ["http://127.0.0.1/*"], js: ["content.js"] }],
        }),
      )
      await writeFile(
        join(extension, "content.js"),
        "document.documentElement.dataset.synthetic = 'ready'",
      )
      fixture = await createLoopbackFixture()
      callback = await new SubscriptionOAuth().startCallback({ state: "synthetic" })
      const runtime = await start({
        upstreamProxyUrl: `http://synthetic:password@127.0.0.1:${fixture.proxyPort}`,
      })
      launching = adapter
        .launch({
          accountId: "diagnostic",
          authorizeUrl: `http://127.0.0.1:${fixture.originPort}/probe`,
          network: { mode: "bound", bridgeUrl: runtime.url, callbackUri: callback.redirectUri },
          fingerprint: {
            ...fingerprint,
            unknownArgs: [
              `--load-extension=${extension}`,
              "--headless=new",
              "--remote-debugging-port=0",
            ],
          },
          signal: controller.signal,
        })
        .catch((error: unknown) => error)
      const portFile = join(adapter.profileDir("diagnostic"), "DevToolsActivePort")
      let port = 0
      await expect
        .poll(
          async () => {
            try {
              port = Number((await readFile(portFile, "utf8")).split("\n")[0])
            } catch {
              port = 0
            }
            return port > 0
          },
          { timeout: 15_000 },
        )
        .toBe(true)
      connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10_000 })
      const context = connection.contexts()[0]
      if (context === undefined) throw new Error("缺少合成浏览器上下文")
      const page = await context.newPage()
      await page.goto("chrome://extensions/")
      await page
        .getByText("Synthetic Path Diagnostic", { exact: true })
        .waitFor({ timeout: 10_000 })
      const actual: unknown = await page.evaluate(
        `(async()=>{const list=await chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true});return list.filter(x=>x.name==="Synthetic Path Diagnostic").map(x=>({path:x.path,state:x.state,location:x.location}))})()`,
      )
      console.log("[DIAG-win-ext]", JSON.stringify({ expected: await realpath(extension), actual }))
      await page.close()
    } finally {
      controller.abort()
      await launching
      if (connection !== undefined) await connection.close().catch(() => undefined)
      await adapter.dispose()
      await Promise.all([start.dispose(), callback?.close(), fixture?.close()])
      await rm(directory, { recursive: true, force: true })
    }
  },
  45_000,
)
