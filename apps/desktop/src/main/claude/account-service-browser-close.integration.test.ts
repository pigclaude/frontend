// 验证用户关闭真实授权浏览器后，授权结束并释放本次 Xray 引用。

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { createHarness, fingerprint, type Harness } from "./account-service-test-fixtures"
import type { ClaudeAccountServiceDeps } from "./account-service"
import { FingerprintChromiumAdapter, type LaunchedBrowser } from "./fingerprint-chromium"
import { SubscriptionOAuth } from "./subscription-oauth"
import { createXrayRuntimeStarter } from "./xray-runtime"

const browserBinary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]
const xrayBinary = process.env["PIGCLAUDE_TEST_XRAY_BIN"]

it.skipIf(!browserBinary || !xrayBinary)(
  "用户关闭授权浏览器后结束授权并回收 Xray",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-browser-close-"))
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
    let observe: (browser: LaunchedBrowser) => void = () => undefined
    const launched = new Promise<LaunchedBrowser>((resolve) => {
      observe = resolve
    })
    const browser: ClaudeAccountServiceDeps["browser"] = {
      ensureAvailable: () => adapter.ensureAvailable(),
      profileDir: (id) => adapter.profileDir(id),
      launch: async (input) => {
        const result = await adapter.launch(input)
        observe(result)
        return result
      },
      deleteProfile: (id) => adapter.deleteProfile(id),
      dispose: () => adapter.dispose(),
    }
    let harness: Harness | undefined
    let connected: Browser | undefined
    let authorization: Promise<unknown> | undefined
    let callback: Awaited<ReturnType<SubscriptionOAuth["startCallback"]>> | undefined
    try {
      const runtime = await start({ upstreamProxyUrl: "http://127.0.0.1:1" })
      callback = await new SubscriptionOAuth().startCallback({
        state: "synthetic",
        timeoutMs: 30_000,
      })
      harness = await createHarness({ browser, callback, proxyRuntime: runtime })
      authorization = harness.service
        .authorize({
          displayName: "合成账号",
          proxyId: "p1",
          fingerprint: {
            ...fingerprint,
            unknownArgs: ["--headless=new", "--remote-debugging-port=0", "--use-mock-keychain"],
          },
        })
        .catch((error: unknown) => error)
      const instance = await within(launched, 15_000)
      const port = await debugPort(join(instance.profileDir, "DevToolsActivePort"))
      connected = await within(chromium.connectOverCDP(`http://127.0.0.1:${port}`), 5_000)
      const session = await within(connected.newBrowserCDPSession(), 5_000)
      await within(session.send("Browser.close"), 5_000)
      const result = await within(authorization, 3_000)
      expect(result).toMatchObject({ code: "AUTHORIZATION_CANCELLED" })
      expect(await portOpen(runtime.url)).toBe(false)
      expect(await harness.service.list()).toEqual([])
    } finally {
      await harness?.service.cancel().catch(() => undefined)
      await authorization
      if (connected !== undefined) await within(connected.close(), 2_000).catch(() => undefined)
      const results = await Promise.allSettled([
        adapter.dispose(),
        start.dispose(),
        callback?.close(),
      ])
      await harness?.cleanup()
      if (results.some((result) => result.status === "rejected")) {
        throw new Error(`测试资源未确认回收，保留临时目录 ${directory}`)
      }
      await rm(directory, { recursive: true, force: true })
    }
  },
  40_000,
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

async function portOpen(value: string): Promise<boolean> {
  const url = new URL(value)
  return new Promise((resolve) => {
    const socket = connect(Number(url.port), url.hostname)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}

async function within<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("浏览器关闭后授权未及时结束")), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
