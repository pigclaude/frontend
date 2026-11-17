// 从安装应用的公开桥验证 SOCKS5、固定浏览器区域、原生诊断及上游中断。
import assert from "node:assert/strict"
import { isIP } from "node:net"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect } from "@playwright/test"
import { startInstalledSocksRelay } from "./test11-socks-relay.mjs"
import { diagnoseLinuxBrowser } from "./test11-linux-browser-diagnostic.mjs"

async function findBrowserPort(userData) {
  const root = join(userData, "local", "browser-profiles")
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const value = await readFile(join(root, entry.name, "DevToolsActivePort"), "utf8").catch(
      () => "",
    )
    const port = Number(value.split("\n")[0])
    if (port > 0 && port < 65536) return port
  }
  return 0
}

async function directControl() {
  const response = await fetch("https://ipv4.icanhazip.com/", {
    signal: AbortSignal.timeout(12000),
  })
  assert.equal(response.status, 200, "公网对照服务不可用")
  assert.equal(isIP((await response.text()).trim()), 4)
  return true
}

/** 使用本轮安装副本与独立中转，所有账号授权操作只到自检和取消。 */
export async function verifyInstalledProxy(app, userData, evidence, pass, browserBinary) {
  const relay = await startInstalledSocksRelay()
  const result = {
    proxy: "authenticated SOCKS5 loopback relay",
    locale: "en-US",
    timezone: "America/Chicago",
    settingsSource: "explicit test profile",
    checks: [],
  }
  let browser
  try {
    const saved = await app.evaluate(async (url) => {
      const proxy = await window.pigclaude.proxies.saveVerified({ name: "test.11 SOCKS5", url })
      return { id: proxy.id, ok: proxy.lastTest?.ok, url: proxy.url }
    }, relay.url)
    assert.equal(saved.ok, true)
    assert(saved.url.startsWith("socks5://") && !saved.url.includes("pass%3Aword"))
    const initial = relay.snapshot()
    assert(initial.authenticated >= 2, "代理保存没有经过两条实际传输路径")
    assert(
      initial.destinations.some((value) => value.host === "ipv4.icanhazip.com" && value.domain),
    )
    result.checks.push(
      "installed public API verified authenticated SOCKS5 and HTTPS exit consistency",
    )
    pass("installed SOCKS5 proxy saved after actual HTTPS and Xray exit checks")

    const profile = await app.evaluate(
      async ({ proxyId, locale, timezone }) => {
        return window.pigclaude.browserProfiles.save({
          name: "test.11 SOCKS5 Intl",
          proxyId,
          fingerprint: {
            seed: "123456",
            brand: "",
            platform: "",
            lang: locale,
            timezone,
            canvasNoise: "",
            clientRectsNoise: "",
            unknownArgs: ["--remote-debugging-port=0"],
            webrtcPolicy: "disable_non_proxied_udp",
          },
        })
      },
      { proxyId: saved.id, locale: result.locale, timezone: result.timezone },
    )
    assert.equal(profile.proxyId, saved.id)
    assert.equal(profile.fingerprint.lang, result.locale)
    assert.equal(profile.fingerprint.timezone, result.timezone)

    result.directServiceReachableBeforeFailure = await directControl()
    relay.fail()
    const deniedBefore = relay.snapshot().denied
    const failed = await app.evaluate(
      async ({ id, url }) => {
        const proxy = await window.pigclaude.proxies.test(id)
        let egress
        try {
          egress = await window.pigclaude.egress.check(id)
        } catch {
          egress = { ok: false }
        }
        let newProxyRejected = false
        try {
          await window.pigclaude.proxies.saveVerified({ name: "failed test.11 SOCKS5", url })
        } catch {
          newProxyRejected = true
        }
        return {
          ok: proxy.lastTest?.ok,
          egressOk: egress.ok,
          newProxyRejected,
          count: (await window.pigclaude.proxies.list()).length,
        }
      },
      { id: saved.id, url: relay.url },
    )
    assert.equal(failed.ok, false)
    assert.equal(failed.egressOk, false)
    assert.equal(failed.newProxyRejected, true)
    assert(relay.snapshot().denied > deniedBefore, "失败请求没有抵达绑定的代理入口")
    assert.equal(failed.count, 1)
    result.directServiceReachableAfterFailure = await directControl()
    result.failedProxy = {
      testRejected: !failed.ok,
      egressRejected: !failed.egressOk,
      proxyIngressObserved: true,
      count: failed.count,
    }
    result.checks.push(
      "selected requests failed with bound SOCKS5 down while direct control remained reachable",
    )
    pass("installed proxy test and egress check fail closed while direct control stays reachable")
    relay.restore()
    const restored = await app.evaluate((id) => window.pigclaude.proxies.test(id), saved.id)
    assert.equal(restored.lastTest?.ok, true, "恢复夹具后代理仍不可用")

    await app.evaluate((browserProfileId) => {
      window.test11AuthorizationFinished = false
      window.test11AuthorizationError = null
      void window.pigclaude.claudeAccounts
        .authorize({
          displayName: "test.11 no-account environment check",
          browserProfileId,
        })
        .catch((error) => {
          window.test11AuthorizationError = String(error.message).replace(
            /(?:https?:|socks5:)[^\s]+/g,
            "[URL]",
          )
        })
        .finally(() => {
          window.test11AuthorizationFinished = true
        })
    }, profile.id)
    await expect.poll(() => findBrowserPort(userData), { timeout: 70000 }).toBeGreaterThan(0)
    browser = await chromium.connectOverCDP("http://127.0.0.1:" + (await findBrowserPort(userData)))
    result.browserVersion = browser.version()
    const context = browser.contexts()[0]
    assert(context, "PigBrowser 没有实际浏览器上下文")
    const reportPage =
      context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 20000 }))
    await reportPage.locator("#export").waitFor({ state: "visible", timeout: 90000 })
    result.browser = await reportPage.evaluate(() => ({
      language: navigator.language,
      languages: [...navigator.languages],
      intlLocales: [
        Intl.DateTimeFormat,
        Intl.NumberFormat,
        Intl.Collator,
        Intl.PluralRules,
        Intl.RelativeTimeFormat,
        Intl.ListFormat,
      ].map((constructor) => new constructor().resolvedOptions().locale),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }))
    assert.equal(result.browser.language, result.locale)
    assert.equal(result.browser.languages[0], result.locale)
    assert(result.browser.intlLocales.every((locale) => locale === result.locale))
    assert.equal(result.browser.timezone, result.timezone)
    const exported = await reportPage.evaluate(async () => {
      let pending
      const original = URL.createObjectURL
      const click = HTMLAnchorElement.prototype.click
      try {
        URL.createObjectURL = (blob) => {
          pending = blob.text()
          return "blob:test11-export"
        }
        HTMLAnchorElement.prototype.click = () => {}
        document.getElementById("export").click()
        return await pending
      } finally {
        URL.createObjectURL = original
        HTMLAnchorElement.prototype.click = click
      }
    })
    const report = JSON.parse(exported)
    result.preflightVerdict = report.verdict
    result.nativeChecks = report.checks.filter(({ id }) =>
      ["cli-launch", "cli-protocol", "environment-consistency", "settings", "cli-intl"].includes(
        id,
      ),
    )
    for (const id of ["cli-launch", "cli-protocol", "environment-consistency", "settings"]) {
      const check = result.nativeChecks.find((item) => item.id === id)
      assert.equal(check?.state, "passed", "安装版未通过 " + id)
    }
    assert.equal(result.nativeChecks.find(({ id }) => id === "cli-intl")?.state, "unknown")
    await writeFile(join(evidence, "environment-report.json"), exported + "\n")
    await reportPage.screenshot({ path: join(evidence, "pigbrowser-environment.png") })
    result.checks.push(
      "installed PigBrowser Intl and native CLI TZ/LANG/LC_ALL match saved profile",
    )
    pass("installed PigBrowser language/timezone and actual native CLI environment agree")

    await app.evaluate(() => window.pigclaude.claudeAccounts.cancelAuthorization())
    await expect
      .poll(() => app.evaluate(() => window.test11AuthorizationFinished), { timeout: 20000 })
      .toBe(true)
    await browser.close().catch(() => {})
    browser = undefined
  } catch (error) {
    result.failure = {
      message: String(error.message).replace(/(?:https?:|socks5:)[^\s]+/g, "[URL]"),
    }
    const state = await app
      .evaluate(() => ({
        finished: window.test11AuthorizationFinished,
        error: window.test11AuthorizationError,
      }))
      .catch(() => null)
    result.authorization = state
    if (process.platform === "linux" && browserBinary)
      await diagnoseLinuxBrowser(browserBinary, userData, evidence)
    throw error
  } finally {
    await app.evaluate(() => window.pigclaude.claudeAccounts.cancelAuthorization()).catch(() => {})
    await browser?.close().catch(() => {})
    result.connections = relay.snapshot()
    await relay.close()
    await writeFile(join(evidence, "installed-proxy.json"), JSON.stringify(result, null, 2) + "\n")
  }
}
