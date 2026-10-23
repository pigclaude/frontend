// 负责本计划真实浏览器会员业务验收，不保存认证材料。
import { expect } from "@playwright/test"
import { test } from "./oauth-oidc-owned-browser"
import { authorizeNative } from "./oauth-oidc-native-client"
import {
  ownedContext,
  config,
  sql,
  record,
  readback,
  screenshot,
  goto,
  login,
  pay,
  selectOffer,
} from "./membership-local-support"
test.setTimeout(300_000)
test("task15 owned membership browser acceptance", async ({ browser }) => {
  const context = await ownedContext(browser, { viewport: { width: 1440, height: 1100 } })
  context.setDefaultTimeout(20_000)
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
  expect(await admin.getByLabel("密钥", { exact: true }).count()).toBe(0)
  await screenshot(admin, "00-payment-configured")
  record(
    "payment-settings",
    JSON.parse(
      sql(
        "SELECT row_to_json(p) FROM (SELECT revision,enabled,gateway_url,pid,pay_types,notify_base_url,key_ciphertext IS NOT NULL AS key_configured FROM payment_settings) p",
      ),
    ),
  )
  await goto(admin, `${config.admin}/tiers`)
  for (const [name, price, options] of [
    [
      "VIP",
      "30",
      [
        ["1", "无", "0"],
        ["3", "立减", "10"],
        ["12", "打折", "7.5"],
      ],
    ],
    [
      "SVIP",
      "50",
      [
        ["1", "无", "0"],
        ["12", "打折", "7.5"],
      ],
    ],
  ] as const) {
    await admin.getByRole("button", { name: `编辑 ${name}`, exact: true }).click()
    await admin.getByLabel("月价（元）", { exact: true }).fill(price)
    await admin.getByRole("switch", { name: "上架", exact: true }).check()
    for (const [i, option] of options.entries()) {
      if ((await admin.getByLabel(`月数 ${i + 1}`, { exact: true }).count()) === 0)
        await admin.getByRole("button", { name: "添加档位", exact: true }).click()
      await admin.getByLabel(`月数 ${i + 1}`, { exact: true }).fill(option[0])
      if (option[1] !== "无") {
        await admin
          .getByRole("radiogroup", { name: `优惠方式 ${i + 1}` })
          .getByRole("radio", { name: option[1], exact: true })
          .click()
        await admin.getByLabel(`优惠值 ${i + 1}`, { exact: true }).fill(option[2])
      }
    }
    await expect(
      admin.getByText(name === "VIP" ? "现价 ¥270.00" : "现价 ¥450.00", { exact: true }),
    ).toBeVisible()
    await screenshot(admin, `00-${name}-preview`, true)
    await admin.getByRole("button", { name: "保存等级", exact: true }).click()
    await expect(admin.getByRole("dialog")).toHaveCount(0)
  }
  await screenshot(admin, "00-tiers-configured")
  record(
    "catalog",
    JSON.parse(
      sql(
        "SELECT json_agg(t) FROM (SELECT code,monthly_price_fen,enabled,(SELECT json_agg(o) FROM membership_tier_options o WHERE o.tier_id=t.id) options FROM membership_tiers t) t",
      ),
    ),
  )
  const user = await context.newPage()
  const email = `${config.runId}-main@example.test`
  await login(user, email, false, true)
  await goto(user, `${config.home}/membership`)
  await selectOffer(user, "VIP", 1)
  const initial = await pay(user, "01-purchase", email, "立即开通", "VIP")
  expect(initial.membership.tier_id).toBe("vip")
  expect(initial.orders[0]?.payable_fen).toBe(3000)
  await selectOffer(user, "VIP", 3)
  const renewal = await pay(user, "02-renew", email, "立即续费", "VIP")
  expect(
    Date.parse(renewal.membership.valid_until) - Date.parse(initial.membership.valid_until),
  ).toBe(90 * 86400000)
  await selectOffer(user, "SVIP", 1)
  const upgraded = await pay(user, "03-upgrade-package", email, "免费升级", "SVIP", true)
  expect(upgraded.membership.tier_id).toBe("svip")
  expect(upgraded.orders[2]?.payable_fen).toBe(0)
  expect(upgraded.orders[2]?.credit_fen).toBeGreaterThan(5000)
  await goto(admin, `${config.admin}/membership`)
  await admin.getByRole("button", { name: "人工授予", exact: false }).first().click()
  await admin.getByRole("button", { name: "选择用户", exact: true }).click()
  await admin.getByRole("combobox", { name: "搜索用户邮箱或 ID" }).fill(email)
  await admin.getByRole("option").filter({ hasText: email }).click()
  await admin
    .getByRole("radiogroup", { name: "授予等级" })
    .getByRole("radio", { name: /^SVIP/ })
    .click()
  await admin.getByLabel("时长", { exact: true }).fill("7")
  await admin
    .getByRole("radiogroup", { name: "时长单位" })
    .getByRole("radio", { name: "天", exact: true })
    .click()
  await admin.getByLabel("授予价值（元）", { exact: true }).fill("0")
  await admin.getByLabel("操作备注", { exact: true }).fill("Task15 local acceptance")
  await expect(admin.getByText(/^生效后：SVIP/)).toBeVisible()
  record("04-grant-preview", await admin.getByText(/^生效后：SVIP/).textContent())
  await screenshot(admin, "04-grant-preview", true)
  await admin.getByRole("button", { name: "确认授予", exact: true }).click()
  await expect(admin.getByRole("dialog")).toHaveCount(0)
  await screenshot(admin, "04-grant-success")
  const granted = readback("04-grant", email)
  expect(
    Date.parse(granted.membership.valid_until) - Date.parse(upgraded.membership.valid_until),
  ).toBe(7 * 86400000)
  const otherContext = await ownedContext(browser, { viewport: { width: 1440, height: 1100 } })
  const other = await otherContext.newPage()
  const otherEmail = `${config.runId}-remaining@example.test`
  await login(other, otherEmail, false, true)
  await goto(other, `${config.home}/membership`)
  await selectOffer(other, "VIP", 1)
  const beforeRemaining = await pay(other, "05-before-remaining", otherEmail, "立即开通", "VIP")
  await selectOffer(other, "SVIP", 1)
  // 横幅的可读名称在块级子元素之间带空格，和 textContent 不同，所以按开头匹配。
  const remainingCta = /^只想升级剩余/
  await expect(other.getByRole("button", { name: remainingCta })).toBeVisible()
  const remaining = await pay(other, "05-upgrade-remaining", otherEmail, remainingCta, "SVIP")
  expect(remaining.membership.valid_until).toBe(beforeRemaining.membership.valid_until)
  expect(remaining.membership.tier_id).toBe("svip")
  expect(remaining.orders[1]?.kind).toBe("upgrade_remaining")
  await goto(admin, `${config.admin}/orders`)
  for (const order of [...granted.orders, ...remaining.orders]) {
    await admin.getByLabel("搜索订单", { exact: true }).fill(order.order_no)
    const response = admin.waitForResponse(
      (r) => r.url().includes("/admin/v1/payment/orders?") && r.url().includes(order.order_no),
    )
    await admin.getByRole("button", { name: "搜索", exact: true }).click()
    const body = (await (await response).json()) as { items: { orderNo: string }[] }
    expect(body.items.map((item) => item.orderNo)).toEqual([order.order_no])
    await admin.locator("tbody tr").first().click()
    const detail = admin.getByRole("dialog", { name: /^订单详情/ })
    await expect(detail.getByText(order.order_no, { exact: true })).toBeVisible()
    await admin.keyboard.press("Escape")
  }
  await screenshot(admin, "06-orders")
  record("06-orders", { visibleOrders: granted.orders.length + remaining.orders.length })
  const tokens = await authorizeNative(user, config.home, `pcd_${"7".repeat(64)}`, async (page) => {
    await expect(page.getByRole("button", { name: "授权并打开桌面端", exact: true })).toBeVisible()
    await screenshot(page, "07-native-approval")
  })
  const entitlement = await fetch(`${config.home}/v1/desktop/entitlement`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  })
  expect(entitlement.status).toBe(200)
  const body = (await entitlement.json()) as { tier: { code: string; cardStyle: string } }
  expect(body.tier.code).toBe("svip")
  expect(body.tier.cardStyle).toBe("gold")
  record("07-native-entitlement", body)
  await goto(user, `${config.home}/membership`)
  await expect(user.getByRole("radiogroup", { name: "会员等级" })).toBeVisible()
  await screenshot(user, "07-native-entitlement-membership")
  readback("07-native-db", email)
  await context.close()
  await otherContext.close()
})
