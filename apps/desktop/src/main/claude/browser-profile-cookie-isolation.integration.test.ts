// 用真实 PigBrowser 验证共享配置标识不共享账号 Cookie，重启同一账号则保留它自己的登录数据。

import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type Browser } from "@playwright/test"
import { expect, it } from "vitest"
import { FingerprintChromiumAdapter } from "./fingerprint-chromium"
import { fingerprint } from "./account-service-test-fixtures"

const binary = process.env["PIGCLAUDE_TEST_CHROMIUM_BIN"]

it.skipIf(!binary)(
  "相同浏览器配置的两个账号使用独立 Cookie，重开账号沿用自身数据",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-shared-profile-cookies-"))
    const origin = createServer((_request, response) => {
      response.setHeader("content-type", "text/html")
      response.end("<!doctype html><title>Synthetic account storage</title>")
    })
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve))
    const address = origin.address()
    if (!address || typeof address === "string") throw new Error("合成页面未监听")
    const url = `http://127.0.0.1:${address.port}/`
    const adapter = new FingerprintChromiumAdapter({
      binaryPath: binary,
      hostArch: process.arch,
      profilesRoot: join(directory, "profiles"),
    })
    const connections: Browser[] = []
    const launch = async (accountId: string) => {
      const instance = await adapter.launch({
        accountId,
        browserProfileId: "same-config",
        authorizeUrl: url,
        network: { mode: "system" },
        fingerprint: {
          ...fingerprint,
          unknownArgs: ["--headless=new", "--remote-debugging-port=0", "--use-mock-keychain"],
        },
      })
      const port = Number(
        (await readFile(join(instance.profileDir, "DevToolsActivePort"), "utf8")).split("\n")[0],
      )
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      connections.push(browser)
      const context = browser.contexts()[0]
      if (!context) throw new Error("真实账号上下文不存在")
      return { ...instance, browser, context }
    }
    try {
      const a = await launch("account-a")
      await a.context.addCookies([
        { url, name: "owned-account", value: "a", expires: Math.floor(Date.now() / 1000) + 3600 },
      ])
      const b = await launch("account-b")
      expect(b.profileDir).not.toBe(a.profileDir)
      expect(
        (await b.context.cookies(url)).find((cookie) => cookie.name === "owned-account"),
      ).toBeUndefined()
      await b.context.addCookies([
        { url, name: "owned-account", value: "b", expires: Math.floor(Date.now() / 1000) + 3600 },
      ])
      expect(
        (await a.context.cookies(url)).find((cookie) => cookie.name === "owned-account")?.value,
      ).toBe("a")
      await a.stop()
      await a.browser.close()
      const reopened = await launch("account-a")
      expect(reopened.profileDir).toBe(a.profileDir)
      expect(
        (await reopened.context.cookies(url)).find((cookie) => cookie.name === "owned-account")
          ?.value,
      ).toBe("a")
      expect(
        (await b.context.cookies(url)).find((cookie) => cookie.name === "owned-account")?.value,
      ).toBe("b")
    } finally {
      const results = await Promise.allSettled([
        adapter.dispose(),
        ...connections.map((browser) => browser.close()),
      ])
      origin.closeAllConnections()
      await new Promise<void>((resolve) => origin.close(() => resolve()))
      if (results[0]?.status === "rejected")
        throw new Error("真实浏览器未确认退出，保留账号测试数据")
      await rm(directory, { recursive: true, force: true })
    }
  },
  60_000,
)
