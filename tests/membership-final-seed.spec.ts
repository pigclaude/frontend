// 通过新owned栈正式路径建立最少视觉夹具，和历史七业务回执完全分开。
import { expect } from "@playwright/test"
import { test } from "./oauth-oidc-owned-browser"
import type { Tier } from "@pigclaude/api/membership/types"
import {
  ownedContext,
  config,
  goto,
  login,
  sql,
  record,
  selectOffer,
  pay,
} from "./membership-local-support"
import { adminWrite } from "./membership-visual-support"
test.setTimeout(180_000)
test("F56 minimal formal visual fixtures", async ({ browser }) => {
  const context = await ownedContext(browser, { viewport: { width: 1280, height: 1000 } })
  try {
    const admin = await context.newPage()
    await login(admin, "admin@example.test", true)
    await goto(admin, `${config.admin}/settings?panel=payment`)
    await admin.getByLabel("网关地址", { exact: true }).fill(config.gateway)
    await admin.getByLabel("PID", { exact: true }).fill(config.gatewayPid)
    if (await admin.getByRole("button", { name: "更换", exact: true }).isVisible())
      await admin.getByRole("button", { name: "更换", exact: true }).click()
    await admin.getByLabel("密钥", { exact: true }).fill(config.gatewayKey)
    await admin.getByLabel("回调站点地址", { exact: true }).fill(config.home)
    await admin.getByRole("switch", { name: "启用支付" }).check()
    await admin.getByRole("switch", { name: "支付宝", exact: true }).check()
    await admin.getByRole("button", { name: "保存", exact: true }).click()
    await expect(admin.getByText("已配置 · 留空则不修改", { exact: true })).toBeVisible()
    expect(await admin.locator('input[type="password"]').count()).toBe(0)
    const tiers = await admin.evaluate(
      async () => (await (await fetch("/admin/v1/membership/tiers")).json()) as { items: Tier[] },
    )
    for (const tier of tiers.items) {
      if (tier.enabled && tier.options.length) continue
      await adminWrite(
        admin,
        `/admin/v1/membership/tiers/${tier.id}`,
        {
          name: tier.name,
          level: tier.level,
          monthlyPriceFen: tier.monthlyPriceFen,
          tagline: tier.tagline,
          cardStyle: tier.cardStyle,
          benefits: tier.benefits,
          enabled: true,
          options: [
            {
              months: 1,
              discountKind: "none",
              discountValue: "0",
              badge: null,
              recommended: false,
              enabled: true,
            },
            {
              months: 3,
              discountKind: "percent",
              discountValue: "7500",
              badge: "推荐",
              recommended: true,
              enabled: true,
            },
          ],
        },
        "PUT",
      )
    }
    for (const [name, tierId] of [
      ["none", null],
      ["vip", "vip"],
      ["svip", "svip"],
      ["offline", "vip"],
      ["main", null],
    ] as const) {
      const user = await context.newPage()
      const email =
        name === "main"
          ? `${config.runId}-main@example.test`
          : `${config.runId}-visual-${name}@example.test`
      const exists = sql(`SELECT count(*) FROM users WHERE email='${email}'`) === "1"
      await login(user, email, false, !exists)
      const userId = sql(`SELECT id FROM users WHERE email='${email}'`)
      if (tierId && sql(`SELECT count(*) FROM memberships WHERE user_id='${userId}'`) === "0")
        await adminWrite(admin, "/admin/v1/membership/grants", {
          userId,
          tierId,
          durationUnit: "day",
          duration: "30",
          valueFen: "0",
          remark: "F56 screenshot fixture only, not original seven business acceptance",
        })
      if (
        name === "main" &&
        sql(
          `SELECT count(*) FROM payment_orders WHERE user_id='${userId}' AND status='activated'`,
        ) === "0"
      ) {
        await goto(user, `${config.home}/membership`)
        await selectOffer(user, "VIP", 1)
        await pay(user, "F56-visual-single-purchase", email, "立即开通", "VIP")
        await adminWrite(admin, "/admin/v1/membership/grants", {
          userId,
          tierId: "svip",
          durationUnit: "day",
          duration: "30",
          valueFen: "0",
          remark: "F56 current SVIP after frozen historical VIP order; visual fixture only",
        })
      }
      record(`F56-visual-${name}`, {
        email,
        userId,
        source:
          "formal registration, grant or one owned fake-gateway payment; visual fixtures only",
      })
      await user.close()
    }
    record(
      "F56-visual-seed-catalog",
      JSON.parse(
        sql(
          "SELECT json_agg(t) FROM (SELECT id,code,monthly_price_fen,enabled FROM membership_tiers) t",
        ),
      ),
    )
  } finally {
    await context.close()
  }
})
