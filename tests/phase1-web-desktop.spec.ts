// 负责真实 Chromium、管理员 UI、生产 Electron、PKCE callback 和重启撤销的第一阶段验收。
import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ListPlansResponse } from "../packages/api/src/home/types"
import type { MembershipSessionRecord } from "../packages/contracts/src/desktop-membership"
import {
  closeDesktop,
  expectDesktopState,
  launchDesktop,
  readDesktopSession,
  startDesktopAuthorization,
  type DesktopHarness,
} from "./phase1-electron-harness"

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`真实验收缺少 ${name}，不能把缺少服务计为通过`)
  return value
}

async function approve(page: Page, url: string, replace = false): Promise<void> {
  await page.goto(url)
  await expect(page.getByRole("heading", { name: "确认设备授权" })).toBeVisible()
  if (replace) {
    await expect(page.getByText("已有设备绑定", { exact: true })).toBeVisible()
    await page.getByLabel("我确认替换现有设备").check()
  }
  await page.getByRole("button", { name: "确认授权", exact: true }).click()
  await expect(page.getByRole("heading", { name: "设备已授权" })).toBeVisible()
  const callback = page.getByRole("link", { name: "返回桌面客户端" })
  await expect(callback).toHaveAttribute("href", /^http:\/\/127\.0\.0\.1:\d+\//)
  await callback.click()
  await expect(page.getByRole("heading", { name: "授权完成", exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe("/oauth/callback")
}

async function assertOldSessionDenied(
  request: APIRequestContext,
  rustUrl: string,
  record: MembershipSessionRecord,
  code: string,
): Promise<void> {
  if (!record.sessionCookie) throw new Error("真实 exchange 缺少可恢复 session cookie")
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
      throw new Error("读取旧会话失败；不记录含 Cookie 的请求错误")
    })
  expect(response.status()).toBe(409)
  const result = (await response.json()) as { code: string }
  expect(result.code).toBe(code)
}

async function membershipRow(page: Page, userId: string): Promise<Locator> {
  const row = page.getByRole("row").filter({ hasText: userId })
  const next = page.getByRole("button", { name: "下一页", exact: true })
  while (true) {
    await expect(next).toHaveText("下一页")
    if ((await row.count()) > 0) {
      await expect(row).toHaveCount(1)
      return row
    }
    if (await next.isDisabled()) throw new Error("真实会员列表中未找到本次验收用户")
    const previous = await page.locator("tbody").innerText()
    const response = page.waitForResponse(
      (value) =>
        new URL(value.url()).pathname === "/admin/v1/memberships" &&
        value.request().method() === "GET",
    )
    await next.click()
    expect((await response).ok()).toBe(true)
    await expect.poll(() => page.locator("tbody").innerText()).not.toBe(previous)
  }
}

async function assertRendererGateRejectsStart(
  desktop: DesktopHarness,
  state: string,
): Promise<void> {
  await expectDesktopState(desktop, state)
  await expect(desktop.window.locator(".app")).toHaveCount(0)
  await desktop.window.getByRole("button", { name: "开始使用", exact: true }).click()
  await expectDesktopState(desktop, state)
  await expect(desktop.window.locator(".app")).toHaveCount(0)
}

test("真实 Web/Admin/Electron 注册登录、授权、重启、替换、解绑和撤销", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(240_000)
  const homeUrl = requiredEnvironment("PIGCLAUDE_HOME_URL")
  const adminUrl = requiredEnvironment("PIGCLAUDE_ADMIN_URL")
  const rustUrl = requiredEnvironment("PIGCLAUDE_RUST_URL")
  const adminAccount = requiredEnvironment("PIGCLAUDE_ACCEPTANCE_ADMIN_ACCOUNT")
  const adminPassword = requiredEnvironment("PIGCLAUDE_ACCEPTANCE_ADMIN_PASSWORD")
  const planId = requiredEnvironment("PIGCLAUDE_ACCEPTANCE_PLAN_ID")
  for (const url of [homeUrl, adminUrl, rustUrl]) {
    expect(new URL(url).hostname).toBe("127.0.0.1")
  }
  const email = `acceptance-${randomUUID()}@example.test`
  const password = randomUUID()
  const profileRoot = await mkdtemp(join(tmpdir(), "pigclaude-real-acceptance-"))
  const desktops: DesktopHarness[] = []
  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()
  const milestones: { step: string; state: string; epoch?: string }[] = []
  function record(step: string, state: string, epoch?: string): void {
    const milestone = { step, state, ...(epoch ? { epoch } : {}) }
    milestones.push(milestone)
    console.log(`[acceptance] ${JSON.stringify(milestone)}`)
  }
  let businessFailed = false
  try {
    await page.goto(`${homeUrl}/register`)
    await page.getByLabel("昵称").fill("真实验收用户")
    await page.getByLabel("邮箱").fill(email)
    await page
      .getByLabel("密码", { exact: true })
      .fill(password)
      .catch(() => {
        throw new Error("用户密码字段填写失败")
      })
    await page.getByRole("button", { name: "创建账号" }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole("heading", { name: "账户概览" })).toBeVisible()
    const me = await page.request.get(`${homeUrl}/v1/user/me`).catch(() => {
      throw new Error("读取真实用户失败；不记录含 Cookie 的请求错误")
    })
    expect(me.ok()).toBe(true)
    const user = (await me.json()) as { id: string }
    const registeredCookies = await page.context().cookies(homeUrl)
    expect(registeredCookies.some((cookie) => cookie.name === "pigclaude_session")).toBe(true)
    record("home.register", "authenticated")
    await page.getByRole("button", { name: "用户菜单", exact: true }).click()
    const [logout] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/v1/auth/logout" &&
          new URL(response.url()).origin === new URL(homeUrl).origin &&
          response.request().method() === "POST",
      ),
      page.getByRole("menuitem", { name: "退出登录", exact: true }).click(),
    ])
    expect(logout.status()).toBe(204)
    await expect(page).toHaveURL(/\/login$/)
    expect(
      (await page.context().cookies(homeUrl)).some((cookie) => cookie.name === "pigclaude_session"),
    ).toBe(false)
    record("home.logout", "cookie-cleared")
    await page.getByLabel("邮箱").fill(email)
    await page
      .getByLabel("密码", { exact: true })
      .fill(password)
      .catch(() => {
        throw new Error("用户密码字段填写失败")
      })
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole("heading", { name: "账户概览" })).toBeVisible()
    expect(
      (await page.context().cookies(homeUrl)).some((cookie) => cookie.name === "pigclaude_session"),
    ).toBe(true)
    record("home.login", "cookie-restored")
    await page.goto(`${homeUrl}/membership`)
    await expect(page.getByText("需要有效会员才能授权设备")).toBeVisible()
    record("home.membership.initial", "blocked")
    const plansResponse = await page.request.get(`${homeUrl}/v1/plans`).catch(() => {
      throw new Error("读取真实套餐失败；不记录含 Cookie 的请求错误")
    })
    expect(plansResponse.ok()).toBe(true)
    const plans = (await plansResponse.json()) as ListPlansResponse
    const plan = plans.items.find((item) => item.id === planId)
    if (!plan) throw new Error("真实服务未提供验收 seed 套餐")

    await admin.goto(`${adminUrl}/login`)
    await admin.getByLabel("账号").fill(adminAccount)
    await admin
      .getByLabel("密码", { exact: true })
      .fill(adminPassword)
      .catch(() => {
        throw new Error("管理员密码字段填写失败")
      })
    await admin.getByRole("button", { name: "登录", exact: true }).click()
    await expect(admin).toHaveURL(/\/users$/)
    record("admin.login", "authenticated")
    await admin.goto(`${adminUrl}/membership`)
    await admin.getByRole("button", { name: "人工授予", exact: true }).click()
    const grant = admin.getByRole("dialog", { name: "人工授予会员" })
    await grant.getByLabel("用户 ID").fill(user.id)
    await grant.getByLabel("套餐 ID").fill(planId)
    await grant.getByLabel("条款版本").fill(plan.termsVersion)
    await grant.getByLabel("操作备注").fill("真实验收授予")
    await grant.getByRole("button", { name: "确认授予" }).click()
    await expect(grant).not.toBeVisible()
    await expect(
      (await membershipRow(admin, user.id)).getByRole("cell", { name: "有效", exact: true }),
    ).toBeVisible()
    await page.reload()
    await expect(page.getByText("等待桌面客户端发起授权", { exact: true })).toBeVisible()
    record("admin.grant-and-home-membership", "active")

    let first = await launchDesktop(join(profileRoot, "first"), rustUrl, homeUrl)
    desktops.push(first)
    await expectDesktopState(first, "signed_out")
    await expect(first.window.locator(".app")).toHaveCount(0)
    record("electron.initial-gate", "signed_out")
    await approve(page, await startDesktopAuthorization(first))
    await expectDesktopState(first, "active")
    const oldSession = await readDesktopSession(first)
    record("electron.pkce-callback", "active", oldSession.bindingEpoch)
    await closeDesktop(first)
    first = await launchDesktop(join(profileRoot, "first"), rustUrl, homeUrl)
    desktops.push(first)
    await expectDesktopState(first, "active")
    const restored = await readDesktopSession(first)
    expect(restored.deviceId).toBe(oldSession.deviceId)
    expect(restored.bindingEpoch).toBe(oldSession.bindingEpoch)
    await expect(first.window.locator(".app")).toBeVisible()
    record("electron.restart-restore", "active", restored.bindingEpoch)

    await approve(page, await startDesktopAuthorization(first), true)
    await expectDesktopState(first, "active")
    const renewed = await readDesktopSession(first)
    expect(renewed.deviceId).toBe(oldSession.deviceId)
    expect(BigInt(renewed.bindingEpoch) > BigInt(oldSession.bindingEpoch)).toBe(true)
    await assertOldSessionDenied(request, rustUrl, oldSession, "AUTHORIZATION_BINDING_STALE")
    record("electron.same-device-renewal", "active", renewed.bindingEpoch)
    record("old-epoch.inspect", "AUTHORIZATION_BINDING_STALE", oldSession.bindingEpoch)

    const second = await launchDesktop(join(profileRoot, "second"), rustUrl, homeUrl)
    desktops.push(second)
    await approve(page, await startDesktopAuthorization(second), true)
    await expectDesktopState(second, "active")
    const replacement = await readDesktopSession(second)
    expect(replacement.deviceId).not.toBe(oldSession.deviceId)
    expect(BigInt(replacement.bindingEpoch) > BigInt(renewed.bindingEpoch)).toBe(true)
    await assertOldSessionDenied(request, rustUrl, renewed, "AUTHORIZATION_DEVICE_REVOKED")
    await assertRendererGateRejectsStart(first, "device_revoked")
    record("electron.other-device-replacement", "active", replacement.bindingEpoch)
    record(
      "old-device.inspect-and-start-gate",
      "AUTHORIZATION_DEVICE_REVOKED",
      renewed.bindingEpoch,
    )

    await admin.goto(`${adminUrl}/devices`)
    await admin.getByLabel("设备用户筛选").fill(user.id)
    await admin.getByRole("button", { name: "筛选", exact: true }).click()
    await admin
      .getByRole("row")
      .filter({ hasText: user.id })
      .getByRole("button", { name: "解绑" })
      .click()
    const unbind = admin.getByRole("dialog", { name: "解绑设备", exact: true })
    await unbind.getByLabel("解绑原因").fill("真实验收解绑")
    await unbind.getByRole("button", { name: "确认解绑" }).click()
    await expect(unbind).not.toBeVisible()
    await assertOldSessionDenied(request, rustUrl, replacement, "AUTHORIZATION_DEVICE_REVOKED")
    await assertRendererGateRejectsStart(second, "device_revoked")
    record("admin.unbind-and-start-gate", "AUTHORIZATION_DEVICE_REVOKED", replacement.bindingEpoch)

    await approve(page, await startDesktopAuthorization(second), true)
    await expectDesktopState(second, "active")
    const rebound = await readDesktopSession(second)
    expect(BigInt(rebound.bindingEpoch) > BigInt(replacement.bindingEpoch)).toBe(true)
    record("electron.rebind", "active", rebound.bindingEpoch)
    await admin.goto(`${adminUrl}/membership`)
    await (await membershipRow(admin, user.id)).getByRole("button", { name: "撤销" }).click()
    const revoke = admin.getByRole("dialog", { name: `撤销用户 ${user.id} 的会员` })
    await revoke.getByLabel("原因", { exact: true }).fill("真实验收撤销")
    await revoke.getByRole("button", { name: "确认", exact: true }).click()
    await expect(revoke).not.toBeVisible()
    await expect(
      (await membershipRow(admin, user.id)).getByRole("cell", { name: "已撤销", exact: true }),
    ).toBeVisible()
    await assertRendererGateRejectsStart(second, "verification_required")
    record("admin.membership-revoke-and-start-gate", "verification_required", rebound.bindingEpoch)
    await page.goto(`${homeUrl}/membership`)
    await expect(page.getByText("需要有效会员才能授权设备")).toBeVisible()
    await admin.goto(`${adminUrl}/audits`)
    await admin.getByLabel("审计用户筛选").fill(user.id)
    await admin.getByRole("button", { name: "筛选", exact: true }).click()
    for (const reason of ["真实验收授予", "真实验收解绑", "真实验收撤销"]) {
      await expect(admin.getByRole("row").filter({ hasText: reason })).toContainText(user.id)
      record(`admin.audit.${reason}`, "visible")
    }
  } catch (error: unknown) {
    businessFailed = true
    throw error
  } finally {
    const cleanupFailures: string[] = []
    for (const desktop of desktops.reverse()) {
      await closeDesktop(desktop).catch(() => cleanupFailures.push("electron"))
    }
    await adminContext.close().catch(() => cleanupFailures.push("browser-context"))
    await rm(profileRoot, { recursive: true, force: true }).catch(() =>
      cleanupFailures.push("profile"),
    )
    record("runtime.cleanup", cleanupFailures.length === 0 ? "closed-and-removed" : "failed")
    await testInfo
      .attach("phase1-acceptance-milestones", {
        body: JSON.stringify(milestones, null, 2),
        contentType: "application/json",
      })
      .catch(() => cleanupFailures.push("milestone-attachment"))
    if (cleanupFailures.length > 0 && !businessFailed) {
      throw new Error(`真实验收清理失败：${cleanupFailures.join(", ")}`)
    }
  }
})
