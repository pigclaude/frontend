// 负责真实Next/Vite代理、浏览器Cookie和中央OIDC表单的本地全链验收；上游仅为HTTP协议mock。
import { expect, type Page } from "@playwright/test"
import { test } from "./oauth-oidc-owned-browser"
import { authorizeNative } from "./oauth-oidc-native-client"

const home = required("OAUTH_TEST_HOME")
const admin = required("OAUTH_TEST_ADMIN")
const password = "runtime-password"
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error("OAUTH_TEST_LAUNCHER_REQUIRED")
  return value
}
async function safeGoto(page: Page, url: string) {
  return page.goto(url).catch(() => {
    throw new Error("LOCAL_BROWSER_NAVIGATION_FAILED")
  })
}
async function request(page: Page, path: string, body?: object, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const response = await fetch(
        path,
        body
          ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : undefined,
      )
      const text = await response.text()
      return {
        status: response.status,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
      }
    },
    { path, body, method },
  )
}
async function passwordForm(page: Page, email: string, register = false) {
  await page.getByLabel("邮箱", { exact: true }).fill(email)
  await page.getByLabel("密码", { exact: true }).fill(password)
  await page.getByRole("button", { name: register ? "创建账号" : "登录", exact: true }).click()
}
async function signup(page: Page, email: string) {
  await safeGoto(page, `${home}/register`)
  await page.getByRole("button", { name: "继续注册", exact: true }).click()
  await passwordForm(page, email, true)
  await page.waitForURL((url) => url.pathname === "/dashboard")
}
async function adminLogin(page: Page) {
  await safeGoto(page, `${admin}/login`)
  await page.getByRole("button", { name: "继续管理员登录" }).click()
  await passwordForm(page, "admin@example.test")
  await page.waitForURL((url) => url.origin === admin && url.pathname === "/users")
}

test.setTimeout(120_000)
test("真实Home注册、Cookie业务、编码返回、正常SSO和强制注册入口", async ({ page }) => {
  await signup(page, "browser-main@example.test")
  const session = await request(page, "/v1/session")
  expect(session.status).toBe(200)
  expect(session.body.principalType).toBe("User")
  expect(Object.keys(session.body).sort()).toEqual([
    "authVersion",
    "csrf",
    "permissions",
    "principalId",
    "principalType",
  ])
  expect((await request(page, "/v1/user/me")).status).toBe(200)
  expect((await request(page, "/v1/entitlement")).status).toBe(200)
  const cookies = await page.context().cookies(home)
  expect(
    cookies
      .filter((cookie) => cookie.name.startsWith("pigclaude_"))
      .every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
  ).toBe(true)
  expect(await page.evaluate(() => document.cookie.includes("pigclaude_session"))).toBe(false)
  const target = "/dashboard?value=%252F%26nested%3Dyes"
  await safeGoto(page, `${home}/login?${new URLSearchParams({ redirect: target })}`)
  await page.getByRole("button", { name: "继续登录", exact: true }).click()
  await page.waitForURL((url) => url.pathname + url.search === target)
  await safeGoto(page, `${home}/register`)
  await page.getByRole("button", { name: "继续注册", exact: true }).click()
  await expect(page.getByRole("button", { name: "创建账号", exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe("/identity/login")
})

test("真实Admin中央密码与Vite代理、独立realm、CSRF和网站退出", async ({ page }) => {
  await adminLogin(page)
  const session = await request(page, "/admin/v1/session")
  expect(session.body.principalType).toBe("Admin")
  expect((await request(page, "/admin/v1/me")).status).toBe(200)
  expect((await request(page, "/admin/v1/web/oidc/logout", { csrf: "wrong" })).status).toBe(401)
  expect((await request(page, "/admin/v1/session")).status).toBe(200)
  expect(
    (await request(page, "/admin/v1/web/oidc/logout", { csrf: session.body.csrf })).status,
  ).toBe(204)
  expect((await request(page, "/admin/v1/session")).status).toBe(401)
  await safeGoto(page, `${home}/`)
  expect((await request(page, "/v1/session")).status).toBe(401)
})

test("Google HTTP mock经真实浏览器与RP回调建立会话，不向网站JS交付token", async ({ page }) => {
  await page.route("https://accounts.google.com/**", async (route) => {
    const response = await fetch(`${required("OAUTH_TEST_CONTROL")}/provider`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-owner": required("OAUTH_TEST_CONTROL_SECRET"),
      },
      body: JSON.stringify({ url: route.request().url(), email: "browser-google@example.test" }),
    })
    if (!response.ok) throw new Error("LOCAL_PROVIDER_FIXTURE_FAILED")
    const result = (await response.json()) as { redirect: string }
    await route.fulfill({ status: 302, headers: { location: result.redirect }, body: "" })
  })
  await safeGoto(page, `${home}/login`)
  await page.getByRole("button", { name: "继续登录", exact: true }).click()
  await page.getByRole("button", { name: /Google/ }).click()
  await page.waitForURL((url) => url.pathname === "/dashboard")
  expect((await request(page, "/v1/session")).status).toBe(200)
  const me = await request(page, "/v1/user/me")
  expect(me.body.email).toBe("browser-google@example.test")
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => /pc_at_|pc_rt_|id_token/.test(String(value))),
    ),
  ).toBe(false)
})

test("两tab各自callback、错误浏览器不消费、退出后的晚callback失效", async ({ page, browser }) => {
  await signup(page, "browser-tabs@example.test")
  const tab = await page.context().newPage()
  const callbacks: string[] = []
  for (const target of [page, tab]) {
    await target.route("**/v1/web/oidc/callback?**", async (route) => {
      callbacks.push(route.request().url())
      await route.fulfill({ status: 200, contentType: "text/plain", body: "Local callback held" })
    })
    await safeGoto(target, `${home}/v1/web/oidc/start?returnTo=%2Fdashboard&maxAge=0`)
    await expect(target.getByLabel("邮箱", { exact: true })).toBeVisible()
  }
  for (const target of [page, tab]) {
    await passwordForm(target, "browser-tabs@example.test")
    await target.waitForURL((url) => url.pathname === "/v1/web/oidc/callback")
  }
  expect(callbacks.length).toBe(2)
  const wrong = await browser.newContext()
  const wrongPage = await wrong.newPage()
  expect((await safeGoto(wrongPage, callbacks[0]!))?.status()).toBe(401)
  await wrong.close()
  await tab.unroute("**/v1/web/oidc/callback?**")
  await safeGoto(tab, callbacks[1]!)
  expect((await request(tab, "/v1/session")).status).toBe(200)
  const session = await request(tab, "/v1/session")
  expect((await request(tab, "/v1/web/oidc/logout", { csrf: session.body.csrf })).status).toBe(204)
  await page.unroute("**/v1/web/oidc/callback?**")
  const late = await safeGoto(page, callbacks[0]!)
  expect(late?.status()).toBe(401)
  expect((await request(tab, "/v1/session")).status).toBe(401)
})

test("浏览器绑定GitHub身份使用近期密码证明，不按相同邮箱自动合并", async ({ page }) => {
  const email = "browser-link@example.test"
  await signup(page, email)
  await page.route("https://github.com/**", async (route) => {
    const response = await fetch(`${required("OAUTH_TEST_CONTROL")}/provider`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-owner": required("OAUTH_TEST_CONTROL_SECRET"),
      },
      body: JSON.stringify({ url: route.request().url(), email }),
    })
    const result = (await response.json()) as { redirect: string }
    await route.fulfill({ status: 302, headers: { location: result.redirect }, body: "" })
  })
  await safeGoto(page, `${home}/v1/web/oidc/start?maxAge=0`)
  await page.getByRole("button", { name: "使用 GitHub 登录", exact: true }).click()
  await page.waitForURL(
    (url) =>
      url.pathname === "/identity/login" &&
      url.searchParams.get("error") === "ACCOUNT_LINK_REQUIRED",
  )
  expect((await request(page, "/v1/user/me")).body.email).toBe(email)
  const session = await request(page, "/v1/session")
  expect(
    (await request(page, "/v1/user/identities/github/link", { csrf: session.body.csrf })).status,
  ).toBe(403)
  expect(
    (
      await request(page, "/v1/user/identities/reauth", {
        csrf: session.body.csrf,
        method: "password",
        password,
        action: { operation: "link", provider: "github" },
      })
    ).status,
  ).toBe(200)
  const link = await request(page, "/v1/user/identities/github/link", { csrf: session.body.csrf })
  expect(link.status).toBe(200)
  await safeGoto(page, String(link.body.redirect))
  await page.waitForURL(
    (url) =>
      url.pathname === "/settings/security" && url.searchParams.get("identityResult") === "linked",
  )
  await expect(page.getByRole("button", { name: "解绑 GitHub", exact: true })).toBeVisible()
  const identities = await request(page, "/v1/user/identities")
  expect(identities.status).toBe(200)
})

test("真实浏览器审批两设备与独立public客户端，会员撤销后保留身份并可撤本关系", async ({ page }) => {
  await signup(page, "browser-native@example.test")
  const me = await request(page, "/v1/user/me")
  const adminPage = await page.context().newPage()
  await adminLogin(adminPage)
  const adminSession = await request(adminPage, "/admin/v1/session")
  const grant = await adminPage.evaluate(
    async ({ user, csrf }) => {
      const response = await fetch("/admin/v1/memberships/grant", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": String(csrf) },
        body: JSON.stringify({
          userId: user,
          planId: "runtime-plan",
          termsVersion: "runtime-v1",
          remark: "local browser",
        }),
      })
      return response.status
    },
    { user: me.body.id, csrf: adminSession.body.csrf },
  )
  expect(grant).toBe(200)
  const first = await authorizeNative(page, home, `pcd_${"1".repeat(64)}`)
  await safeGoto(page, `${home}/dashboard`)
  const second = await authorizeNative(page, home, `pcd_${"2".repeat(64)}`)
  const session = (token: string) =>
    fetch(`${home}/v1/desktop/session`, { headers: { authorization: `Bearer ${token}` } })
  expect((await session(first.access_token)).status).toBe(200)
  expect((await session(second.access_token)).status).toBe(200)
  await safeGoto(page, `${home}/settings/devices`)
  await expect(page.getByText("Local browser device").first()).toBeVisible()
  const revokeMembership = await adminPage.evaluate(
    async ({ user, csrf }) => {
      const response = await fetch(`/admin/v1/memberships/${String(user)}/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": String(csrf) },
        body: JSON.stringify({ reason: "local browser" }),
      })
      return response.status
    },
    { user: me.body.id, csrf: adminSession.body.csrf },
  )
  expect(revokeMembership).toBe(200)
  expect((await request(page, "/v1/user/devices")).status).toBe(200)
  const revoke = await fetch(`${home}/v1/desktop/devices/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${first.access_token}`, "content-type": "application/json" },
    body: "{}",
  })
  expect(revoke.status).toBe(204)
  expect((await session(first.access_token)).status).toBe(401)
  expect((await session(second.access_token)).status).toBe(200)
  for (const [operation, version] of [
    ["ban", "1"],
    ["unban", "2"],
  ]) {
    expect(
      (
        await request(adminPage, `/admin/v1/users/${String(me.body.id)}/${operation}`, {
          csrf: adminSession.body.csrf,
          expectedAuthVersion: version,
          reason: "local browser lifecycle",
        })
      ).status,
    ).toBe(200)
    expect((await session(second.access_token)).status).toBe(401)
    expect((await request(page, "/v1/session")).status).toBe(401)
  }
})
