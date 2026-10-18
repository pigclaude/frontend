// 负责已安装 app.asar 的真实私有协议、PKCE、系统加密、重启和设备代次验收。
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { MembershipSessionRecord } from "../packages/contracts/src/desktop-membership"
import {
  closeDesktop,
  expectDesktopState,
  readDesktopSession,
  startDesktopAuthorization,
  type DesktopHarness,
} from "./phase1-electron-harness"
import {
  dispatchProtocol,
  launchInstalled,
  protocolEventCount,
  requiredEnvironment,
  verifyColdProtocolRejection,
} from "./phase1-packaged-harness"
import {
  grantPackagedMembership,
  registerPackagedUser,
  unbindPackagedDevice,
} from "./phase1-packaged-web"

type Milestone = { step: string; state: string; epoch?: string }

async function approvePrivateProtocol(
  page: Page,
  desktop: DesktopHarness,
  homeUrl: string,
  replace: boolean,
  attemptBrowser = true,
): Promise<string> {
  const authorizationUrl = await startDesktopAuthorization(desktop)
  expect(new URL(authorizationUrl).origin).toBe(homeUrl)
  await page.goto(authorizationUrl).catch(() => {
    throw new Error("打开真实授权 URL 失败；不记录 flow 地址")
  })
  await expect(page.getByRole("heading", { name: "确认设备授权" })).toBeVisible()
  if (replace) {
    await expect(page.getByText("已有设备绑定", { exact: true })).toBeVisible()
    await page.getByLabel("我确认替换现有设备").check()
  }
  await page.getByRole("button", { name: "确认授权", exact: true }).click()
  await expect(page.getByRole("heading", { name: "设备已授权" })).toBeVisible()
  const callback = page.getByRole("link", { name: "返回桌面客户端" })
  const href = await callback.getAttribute("href")
  if (!href) throw new Error("授权页面没有 callback 链接")
  const parsed = new URL(href)
  expect(`${parsed.protocol}//${parsed.host}${parsed.pathname}`).toBe(
    "pigclaude://authorize/callback",
  )
  expect([...parsed.searchParams.keys()].sort()).toEqual(["code", "flow_id", "state"])
  expect(["code", "flow_id", "state"].every((key) => Boolean(parsed.searchParams.get(key)))).toBe(
    true,
  )
  const before = await protocolEventCount(desktop.application)
  let browserDispatched = false
  if (attemptBrowser) {
    const requireBrowserDispatch = process.env["PIGCLAUDE_REQUIRE_BROWSER_DISPATCH"] === "1"
    await callback.click().catch(() => {
      throw new Error("浏览器点击私有协议链接失败；需检查外部应用提示")
    })
    const received = expect
      .poll(() => protocolEventCount(desktop.application), {
        timeout: requireBrowserDispatch ? 60_000 : 2_000,
      })
      .toBeGreaterThan(before)
    if (requireBrowserDispatch) {
      await received
      browserDispatched = true
    } else {
      await received
        .then(() => {
          browserDispatched = true
        })
        .catch(() => undefined)
    }
  }
  if (browserDispatched) {
    await expectDesktopState(desktop, "active")
    return "chromium-click-to-native-open-url"
  }
  await dispatchProtocol(href)
  await expect.poll(() => protocolEventCount(desktop.application)).toBeGreaterThan(before)
  await expectDesktopState(desktop, "active")
  return attemptBrowser
    ? "chromium-link-click-attempted;os-open-to-native-open-url;browser-prompt-unverified"
    : "os-open-to-native-open-url"
}

async function deniedSession(
  request: APIRequestContext,
  rustUrl: string,
  record: MembershipSessionRecord,
  code: string,
): Promise<void> {
  if (!record.sessionCookie) throw new Error("真实 exchange 未持久化 session cookie")
  const query = new URLSearchParams({
    deviceId: record.deviceId,
    bindingEpoch: record.bindingEpoch,
  })
  const cookie = record.sessionCookie.startsWith("pigclaude_session=")
    ? record.sessionCookie
    : `pigclaude_session=${record.sessionCookie}`
  const response = await request
    .get(`${rustUrl}/v1/desktop/membership/inspect?${query}`, {
      headers: { cookie },
    })
    .catch(() => {
      throw new Error("旧 session 检查请求失败；不记录含 Cookie 的请求错误")
    })
  expect(response.status()).toBe(409)
  expect(((await response.json()) as { code: string }).code).toBe(code)
}

async function rejectsStart(desktop: DesktopHarness): Promise<void> {
  await expectDesktopState(desktop, "device_revoked")
  await expect(desktop.window.locator(".app")).toHaveCount(0)
  await desktop.window.getByRole("button", { name: "开始使用", exact: true }).click()
  await expectDesktopState(desktop, "device_revoked")
  await expect(desktop.window.locator(".app")).toHaveCount(0)
}

async function rejectsColdRevokedProfile(desktop: DesktopHarness): Promise<void> {
  await expectDesktopState(desktop, "device_revoked")
  await expect(
    desktop.window.getByText("这台设备已被撤销，请重新授权当前设备。", { exact: true }),
  ).toBeVisible()
  await expect(desktop.window.getByRole("button", { name: "登录", exact: true })).toBeVisible()
  await expect(desktop.window.getByRole("button", { name: "登录", exact: true })).toBeEnabled()
  await expect(desktop.window.getByRole("button", { name: "注册", exact: true })).toBeVisible()
  await expect(desktop.window.getByRole("button", { name: "开始使用", exact: true })).toHaveCount(0)
  await expect(desktop.window.locator(".app")).toHaveCount(0)
}

test("安装版私有协议真实 OS 派发、PKCE、重启、epoch 与解绑门禁", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(240_000)
  const installedApp = requiredEnvironment("PIGCLAUDE_INSTALLED_APP")
  const homeUrl = requiredEnvironment("PIGCLAUDE_HOME_URL")
  const adminUrl = requiredEnvironment("PIGCLAUDE_ADMIN_URL")
  const rustUrl = requiredEnvironment("PIGCLAUDE_RUST_URL")
  for (const url of [homeUrl, adminUrl, rustUrl]) expect(new URL(url).hostname).toBe("127.0.0.1")
  const endpoints = { rustBaseUrl: rustUrl, authOrigin: homeUrl }
  const profileRoot = await mkdtemp(join(tmpdir(), "pigclaude-packaged-acceptance-"))
  const desktops: DesktopHarness[] = []
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  const milestones: Milestone[] = []
  const record = (step: string, state: string, epoch?: string): void => {
    const milestone = { step, state, ...(epoch ? { epoch } : {}) }
    milestones.push(milestone)
    console.log(`[packaged-acceptance] ${JSON.stringify(milestone)}`)
  }
  let businessFailed = false
  try {
    record(
      "browser.dispatch-mode",
      process.env["PIGCLAUDE_REQUIRE_BROWSER_DISPATCH"] === "1"
        ? "strict-click-no-fallback"
        : "click-attempt-then-os-fallback",
    )
    const userId = await registerPackagedUser(page, homeUrl)
    await grantPackagedMembership(page, admin, homeUrl, adminUrl, userId)
    record("web.register-logout-login-admin-ui-grant", "active")
    await verifyColdProtocolRejection(installedApp, join(profileRoot, "cold"))
    record("os-url.cold-start-installed-handler-no-active-session", "signed_out")
    let desktop = await launchInstalled(installedApp, join(profileRoot, "first"), endpoints)
    desktops.push(desktop)
    record(
      "installed.package",
      `isPackaged=true;bundleId=com.pigclaude.desktop;appPath=${installedApp}/Contents/Resources/app.asar;endpoint-env=absent`,
    )
    await expectDesktopState(desktop, "signed_out")
    record("protocol.pkce", await approvePrivateProtocol(page, desktop, homeUrl, false))
    const initial = await readDesktopSession(desktop)
    record("installed.callback-exchange", "active", initial.bindingEpoch)
    await closeDesktop(desktop)
    desktop = await launchInstalled(installedApp, join(profileRoot, "first"), endpoints)
    desktops.push(desktop)
    await expectDesktopState(desktop, "active")
    const restored = await readDesktopSession(desktop)
    expect(restored.deviceId === initial.deviceId).toBe(true)
    expect(restored.bindingEpoch).toBe(initial.bindingEpoch)
    await expect(desktop.window.locator(".app")).toBeVisible()
    record("installed.same-profile-restart", "active", restored.bindingEpoch)
    record(
      "protocol.same-device",
      await approvePrivateProtocol(page, desktop, homeUrl, true, false),
    )
    const renewed = await readDesktopSession(desktop)
    expect(renewed.deviceId === initial.deviceId).toBe(true)
    expect(BigInt(renewed.bindingEpoch) > BigInt(initial.bindingEpoch)).toBe(true)
    await deniedSession(request, rustUrl, initial, "AUTHORIZATION_BINDING_STALE")
    record("installed.same-device-renewal", "active", renewed.bindingEpoch)
    record("old-epoch.inspect", "409 AUTHORIZATION_BINDING_STALE", initial.bindingEpoch)
    await closeDesktop(desktop)
    desktop = await launchInstalled(installedApp, join(profileRoot, "second"), endpoints)
    desktops.push(desktop)
    record(
      "protocol.other-device",
      await approvePrivateProtocol(page, desktop, homeUrl, true, false),
    )
    const replacement = await readDesktopSession(desktop)
    expect(replacement.deviceId !== renewed.deviceId).toBe(true)
    expect(BigInt(replacement.bindingEpoch) > BigInt(renewed.bindingEpoch)).toBe(true)
    await deniedSession(request, rustUrl, renewed, "AUTHORIZATION_DEVICE_REVOKED")
    record("installed.sequential-other-device-replacement", "active", replacement.bindingEpoch)
    await unbindPackagedDevice(admin, adminUrl, userId)
    await deniedSession(request, rustUrl, replacement, "AUTHORIZATION_DEVICE_REVOKED")
    await rejectsStart(desktop)
    record(
      "admin.unbind-start-button-click-native-gate",
      "device_revoked",
      replacement.bindingEpoch,
    )
    record("protocol.rebind", await approvePrivateProtocol(page, desktop, homeUrl, true, false))
    const rebound = await readDesktopSession(desktop)
    expect(rebound.deviceId === replacement.deviceId).toBe(true)
    expect(BigInt(rebound.bindingEpoch) > BigInt(replacement.bindingEpoch)).toBe(true)
    record("installed.rebind", "active", rebound.bindingEpoch)
    await closeDesktop(desktop)
    desktop = await launchInstalled(installedApp, join(profileRoot, "first"), endpoints)
    desktops.push(desktop)
    await rejectsColdRevokedProfile(desktop)
    record(
      "installed.old-device-cold-start-gate",
      "device_revoked;login-entry-visible;start-button-absent-no-click-claimed",
      renewed.bindingEpoch,
    )
  } catch (error: unknown) {
    businessFailed = true
    throw error
  } finally {
    const failures: string[] = []
    for (const desktop of desktops.reverse())
      await closeDesktop(desktop).catch(() => failures.push("app"))
    await adminContext.close().catch(() => failures.push("admin-context"))
    await rm(profileRoot, { recursive: true, force: true }).catch(() => failures.push("profile"))
    record("runtime.cleanup", failures.length === 0 ? "closed-and-removed" : "failed")
    await testInfo
      .attach("packaged-protocol-milestones", {
        body: JSON.stringify(milestones, null, 2),
        contentType: "application/json",
      })
      .catch(() => failures.push("milestones"))
    if (failures.length > 0 && !businessFailed)
      throw new Error(`验收清理失败：${failures.join(", ")}`)
  }
})
