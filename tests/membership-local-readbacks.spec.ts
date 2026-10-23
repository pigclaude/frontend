// 负责本轮购买历史、独立统计、受控待处理与主题持久化真实读回。
import { expect } from "@playwright/test"
import { test } from "./oauth-oidc-owned-browser"
import { authorizeNative } from "./oauth-oidc-native-client"
import { ownedContext, config, goto, login, record, sql } from "./membership-local-support"
test.setTimeout(180_000)
test("owned history summary attention and rose persistence", async ({ browser }) => {
  const context = await ownedContext(browser)
  context.setDefaultTimeout(20_000)
  const user = await context.newPage()
  const email = `${config.runId}-main@example.test`
  await login(user, email)
  await goto(user, `${config.home}/membership`)
  const historyResponse = user.waitForResponse((r) =>
    r.url().includes("/v1/membership/orders?limit=10"),
  )
  await user.getByRole("button", { name: "购买记录", exact: true }).click()
  const history = (await (await historyResponse).json()) as {
    items: { orderNo: string; status: string }[]
  }
  const actual = sql(
    `SELECT order_no FROM payment_orders o JOIN users u ON u.id=o.user_id WHERE u.email='${email}' ORDER BY order_no`,
  ).split("\n")
  expect(history.items.map((o) => o.orderNo).sort()).toEqual(actual)
  await expect(user.locator("li").filter({ hasText: "已生效" })).toHaveCount(actual.length)
  record("11-history-association", {
    api: history,
    databaseOrderNumbers: actual,
    ordinaryRowsOmitOrderNo: true,
  })
  await user.getByRole("button", { name: "主题色", exact: true }).click()
  await user.getByRole("radio", { name: "猪鼻粉", exact: true }).click()
  await user.keyboard.press("Escape")
  const accent = () =>
    user.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--accent").trim())
  expect(await accent()).toBe("#c2496c")
  await user.reload()
  await expect(user.getByRole("radiogroup", { name: "会员等级" })).toBeVisible()
  expect(await accent()).toBe("#c2496c")
  record("12-rose-persistence", {
    before: "#c2496c",
    after: await accent(),
    cache: await user.evaluate(
      () => JSON.parse(localStorage.getItem("pigclaude-accent") ?? "null") as unknown,
    ),
  })
  await user.getByRole("button", { name: "主题色", exact: true }).click()
  await user.getByRole("button", { name: "恢复默认", exact: true }).click()
  await user.keyboard.press("Escape")
  const admin = await context.newPage()
  await login(admin, "admin@example.test", true)
  const summaryResponse = admin.waitForResponse((r) =>
    r.url().endsWith("/admin/v1/payment/orders/summary"),
  )
  await goto(admin, `${config.admin}/orders`)
  const summary = (await (await summaryResponse).json()) as { todayPaidFen: string }
  const expectedPaid = sql(
    "SELECT coalesce(sum(paid_fen),0) FROM payment_orders WHERE paid_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'",
  )
  expect(summary.todayPaidFen).toBe(expectedPaid)
  expect(BigInt(summary.todayPaidFen)).toBeGreaterThan(0n)
  await expect(
    admin
      .getByRole("region", { name: "订单统计" })
      .getByText(`¥${(Number(summary.todayPaidFen) / 100).toFixed(2)}`, { exact: true })
      .first(),
  ).toBeVisible()
  record("13-summary", { api: summary, databaseTodayPaidFen: expectedPaid })
  const order = actual[0]
  expect(order).toMatch(/^PC[0-9A-Z]{20}$/)
  const before = sql(
    `SELECT json_build_object('orderNo',order_no,'status',status,'shortfall',credit_shortfall_fen) FROM payment_orders WHERE order_no='${order}'`,
  )
  const originalShortfall = sql(
    `SELECT credit_shortfall_fen::text FROM payment_orders WHERE order_no='${order}' AND user_id=(SELECT id FROM users WHERE email='${email}')`,
  )
  expect(originalShortfall).toMatch(/^\d+$/)
  try {
    sql(
      `UPDATE payment_orders SET credit_shortfall_fen=1 WHERE order_no='${order}' AND user_id=(SELECT id FROM users WHERE email='${email}')`,
    )
    await admin.getByRole("button", { name: "刷新", exact: true }).click()
    const attentionResponse = admin.waitForResponse(
      (r) => r.url().includes("/admin/v1/payment/orders?") && r.url().includes("needsReview=true"),
    )
    await admin.getByRole("tab", { name: /^待处理/ }).click()
    const attention = (await (await attentionResponse).json()) as { items: { orderNo: string }[] }
    expect(attention.items.map((o) => o.orderNo)).toContain(order)
    await expect(admin.getByLabel("少收警示", { exact: true })).toBeVisible()
    record("14-attention-controlled-fixture", {
      reason: "Owned SQL visual/filter fixture, not real gateway shortfall",
      before: JSON.parse(before),
      after: JSON.parse(
        sql(
          `SELECT json_build_object('orderNo',order_no,'status',status,'shortfall',credit_shortfall_fen) FROM payment_orders WHERE order_no='${order}'`,
        ),
      ),
      api: attention,
    })
  } finally {
    try {
      sql(
        `UPDATE payment_orders SET credit_shortfall_fen=${originalShortfall} WHERE order_no='${order}' AND user_id=(SELECT id FROM users WHERE email='${email}')`,
      )
      const restored = sql(
        `SELECT credit_shortfall_fen::text FROM payment_orders WHERE order_no='${order}' AND user_id=(SELECT id FROM users WHERE email='${email}')`,
      )
      expect(restored).toBe(originalShortfall)
      record("14-attention-restoration", { orderNo: order, originalShortfall, restored })
    } finally {
      await context.close()
    }
  }
})
test("activated return-only closes after real-time success window", async ({ browser }) => {
  const context = await ownedContext(browser)
  const page = await context.newPage()
  await login(page, `${config.runId}-main@example.test`)
  const order = sql(
    `SELECT order_no FROM payment_orders o JOIN users u ON u.id=o.user_id WHERE u.email='${config.runId}-main@example.test' AND o.status='activated' ORDER BY o.created_at LIMIT 1`,
  )
  await goto(page, `${config.home}/membership?order=${order}`)
  const panel = page.getByRole("dialog", { name: "会员支付" })
  await expect(panel.getByRole("status").filter({ hasText: "已生效" })).toBeVisible()
  const start = Date.now()
  await expect(panel).toHaveCount(0)
  const elapsed = Date.now() - start
  expect(elapsed).toBeGreaterThan(1800)
  expect(elapsed).toBeLessThan(6000)
  await expect(page.getByRole("radiogroup", { name: "会员等级" })).toBeVisible()
  record("15-real-time-auto-close", {
    orderNo: order,
    elapsedObservedMs: elapsed,
    browserClockControlled: false,
    returnOnly: true,
  })
  await context.close()
})
test("native protocol uses exact owned origins and gold entitlement", async ({ browser }) => {
  const context = await ownedContext(browser)
  const page = await context.newPage()
  await login(page, `${config.runId}-main@example.test`)
  const token = await authorizeNative(page, config.home, `pcd_${"9".repeat(64)}`)
  const response = await fetch(`${config.home}/v1/desktop/entitlement`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  })
  expect(response.status).toBe(200)
  const entitlement = (await response.json()) as { tier: { code: string; cardStyle: string } }
  expect(entitlement.tier.code).toBe("svip")
  expect(entitlement.tier.cardStyle).toBe("gold")
  record("16-native-gold-exact-origins", entitlement)
  await context.close()
})
