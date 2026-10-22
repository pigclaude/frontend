// 负责会员验收的会话过期和最终可视读回，不重做购买。
import { test, expect } from "@playwright/test"
import { authorizeNative } from "./oauth-oidc-native-client"
import { config, sql, record, screenshot, goto, login } from "./membership-local-support"
test.setTimeout(180_000)
test("task17 Issue1 concurrent refresh and expiry UI", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const user = await context.newPage()
  const email = "task17-main@example.test"
  await login(user, email)
  await goto(user, `${config.home}/membership`)
  sql(
    `UPDATE rp_sessions SET access_expires_at=NOW()-interval '1 second' WHERE user_id=(SELECT id FROM users WHERE email='${email}')`,
  )
  const refresh = await user.evaluate(async () =>
    Promise.all(
      ["/v1/user/me", "/v1/entitlement"].map(async (path) => {
        const response = await fetch(path)
        return { path, status: response.status }
      }),
    ),
  )
  expect(refresh.map((r) => r.status)).toEqual([200, 200])
  record("08-concurrent-refresh", refresh)
  record(
    "08-session-db",
    JSON.parse(
      sql(
        `SELECT json_agg(s) FROM (SELECT access_expires_at>NOW() AS refreshed,revoked_at IS NULL AS active FROM rp_sessions WHERE user_id=(SELECT id FROM users WHERE email='${email}')) s`,
      ),
    ),
  )
  await screenshot(user, "08-concurrent-refresh")
  for (const [name, origin] of [
    ["home", config.home],
    ["admin", config.admin],
  ]) {
    const expiryContext = await browser.newContext({ viewport: { width: 1100, height: 900 } })
    const expiry = await expiryContext.newPage()
    await expiry.clock.install()
    await goto(expiry, `${origin}/login`)
    await expect(expiry.getByLabel("邮箱", { exact: true })).toBeVisible()
    await expiry.clock.fastForward(16 * 60 * 1000)
    record(
      `09-alert-dom-${name}`,
      await expiry.getByRole("alert").evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: node.textContent,
          tag: node.tagName,
          parent: node.parentElement?.tagName,
        })),
      ),
    )
    await expect(expiry.locator("main").getByRole("alert")).toHaveCount(1)
    await expect(expiry.getByRole("link", { name: "重新登录", exact: true })).toHaveAttribute(
      "href",
      `${origin}/login`,
    )
    await expect(expiry.getByLabel("邮箱", { exact: true })).toHaveCount(0)
    await screenshot(expiry, `09-expiry-${name}`)
    record(`09-expiry-${name}`, {
      clock: "browser clock fastForward 16 minutes; real server clock unchanged",
      noticeCount: 1,
      restart: `${origin}/login`,
    })
    await expiry.clock.setSystemTime(Date.now())
    await expiry.getByRole("link", { name: "重新登录", exact: true }).click()
    await expiry.waitForTimeout(500)
    record(`09-restart-debug-${name}`, {
      path: new URL(expiry.url()).pathname,
      clientTime: await expiry.evaluate(() => Date.now()),
      serverTime: Date.now(),
      text: await expiry.locator("main").textContent(),
    })
    if (await expiry.getByRole("button", { name: "重新登录", exact: true }).isVisible())
      await expiry.getByRole("button", { name: "重新登录", exact: true }).click()
    await expect(expiry.getByLabel("邮箱", { exact: true })).toBeVisible()
    record(`09-restart-confirmed-${name}`, {
      formVisible: true,
      path: new URL(expiry.url()).pathname,
    })
    await expiryContext.close()
  }
  await user.clock.install()
  let expiredNative = false
  await authorizeNative(user, config.home, `pcd_${"8".repeat(64)}`, async (page) => {
    await expect(page.getByRole("button", { name: "授权并打开桌面端", exact: true })).toBeVisible()
    await page.clock.fastForward(16 * 60 * 1000)
    await expect(page.locator("main").getByRole("alert")).toHaveCount(1)
    await expect(
      page.getByText("本次授权已过期，请回到 PigClaude 桌面端重新发起授权。", { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole("link", { name: "重新登录", exact: true })).toHaveCount(0)
    await screenshot(page, "09-expiry-native")
    record("09-expiry-native", {
      clock: "browser clock fastForward 16 minutes; real server clock unchanged",
      noticeCount: 1,
      restart: "return to desktop",
    })
    expiredNative = true
    throw new Error("EXPECTED_NATIVE_EXPIRY")
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== "EXPECTED_NATIVE_EXPIRY") throw error
  })
  expect(expiredNative).toBe(true)
  await context.close()
})

test("task17 final visual readback", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1500 } })
  const page = await context.newPage()
  await login(page, "task17-main@example.test")
  await goto(page, `${config.home}/membership`)
  await expect(page.getByText(/有效期至/)).toBeVisible()
  expect(await page.getByText(/有效期至/).textContent()).not.toMatch(/T\d{2}:/)
  await page.evaluate(() => window.scrollTo(0, 0))
  const title = await page.getByRole("heading", { name: "会员", exact: true }).boundingBox()
  const header = await page.locator("header").first().boundingBox()
  expect(title && header && title.y >= header.y + header.height).toBe(true)
  record("10-membership-layout", {
    title,
    header,
    scrollY: await page.evaluate(() => scrollY),
    expiry: await page.getByText(/有效期至/).textContent(),
  })
  await screenshot(page, "07-native-entitlement-membership")
  await login(page, "admin@example.test", true)
  await goto(page, `${config.admin}/orders`)
  await expect(page.locator("tbody").getByText("已生效", { exact: true }).first()).toBeVisible()
  const cells = await page.locator("tbody tr").allTextContents()
  expect(cells).toHaveLength(5)
  for (const text of cells) {
    expect(text).toContain("已生效")
    expect(text).toMatch(/2026-/)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  }
  record("10-orders-accessible-rows", cells)
  await page.locator("table").evaluate((table) => {
    let parent = table.parentElement
    while (parent) {
      if (parent.scrollWidth > parent.clientWidth) {
        parent.scrollLeft = parent.scrollWidth
        return
      }
      parent = parent.parentElement
    }
  })
  await screenshot(page, "06-orders-right")
  await context.close()
})
