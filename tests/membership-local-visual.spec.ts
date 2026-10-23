// 负责16真实业务场景×三宽度×两实际主题截图；每格独立context且不保存认证材料。
import { expect, type BrowserContext } from "@playwright/test"
import { test } from "./oauth-oidc-owned-browser"
import { startBoundaryCanary } from "./membership-boundary-canary"
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"
import type { Tier } from "@pigclaude/api/membership/types"
import {
  config,
  evidence,
  goto,
  login,
  record,
  sql,
  ownedContext,
} from "./membership-local-support"
import {
  adminWrite,
  captureCell,
  openGrant,
  setTheme,
  setTierEnabled,
} from "./membership-visual-support"
test.setTimeout(900_000)
test("96 base and 18 scroll supplements real state membership matrix", async ({ browser }) => {
  const smoke = process.env["MEMBERSHIP_BOUNDARY_SMOKE"] === "1"
  const canary = smoke ? await startBoundaryCanary() : undefined
  try {
    const setup = await ownedContext(browser)
    await canary?.verify(setup, "visual-admin-setup")
    const admin = await setup.newPage()
    await login(admin, "admin@example.test", true)
    if (smoke) {
      const actual = await admin.evaluate(
        async () => (await (await fetch("/admin/v1/me")).json()) as { id: string },
      )
      expect(actual.id).toBe(sql("SELECT id FROM admin_users WHERE email='admin@example.test'"))
    }
    const adminState = await setup.storageState()
    const tiers = await admin.evaluate(
      async () => (await (await fetch("/admin/v1/membership/tiers")).json()) as { items: Tier[] },
    )
    const vip = tiers.items.find((tier) => tier.code === "vip")
    expect(vip).toBeTruthy()
    if (!vip) throw new Error("VIP_REQUIRED")
    const states = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>()
    for (const [name, tier] of [
      ["none", null],
      ["vip", "vip"],
      ["svip", "svip"],
      ["offline", "vip"],
    ] as const) {
      const context = await ownedContext(browser)
      await canary?.verify(context, `visual-${name}-setup`)
      const page = await context.newPage()
      const email = `${config.runId}-visual-${name}@example.test`
      const exists = sql(`SELECT count(*) FROM users WHERE email='${email}'`) === "1"
      if (smoke) expect(exists).toBe(true)
      await login(page, email, false, !exists)
      const userId = sql(`SELECT id FROM users WHERE email='${email}'`)
      if (smoke) {
        const actualId = await page.evaluate(
          async () => (await (await fetch("/v1/user/me")).json()).id as string,
        )
        expect(actualId).toBe(userId)
      }
      if (
        !smoke &&
        tier &&
        sql(`SELECT count(*) FROM memberships WHERE user_id='${userId}'`) === "0"
      )
        await adminWrite(admin, "/admin/v1/membership/grants", {
          userId,
          tierId: tier,
          durationUnit: "day",
          duration: "30",
          valueFen: "0",
          remark: `Task15 visual ${name}`,
        })
      record(`visual-${name}-setup`, {
        email,
        userId,
        tier,
        source: tier ? "real admin grant API" : "real registration",
      })
      states.set(name, await context.storageState())
      await context.close()
    }
    const mainContext = await ownedContext(browser)
    await canary?.verify(mainContext, "visual-main-setup")
    const main = await mainContext.newPage()
    await login(main, `${config.runId}-main@example.test`)
    if (smoke) {
      const actualId = await main.evaluate(
        async () => (await (await fetch("/v1/user/me")).json()).id as string,
      )
      expect(actualId).toBe(
        sql(`SELECT id FROM users WHERE email='${config.runId}-main@example.test'`),
      )
    }
    states.set("main", await mainContext.storageState())
    await mainContext.close()
    if (smoke) {
      record("F53-bounded-setup-smoke", canary?.receipt())
      await setup.close()
      return
    }
    const order = sql(
      `SELECT order_no FROM payment_orders o JOIN users u ON u.id=o.user_id WHERE u.email='${config.runId}-main@example.test' AND o.status='activated' AND o.tier_code='svip' ORDER BY o.created_at LIMIT 1`,
    )
    record(
      "visual-success-order-association",
      JSON.parse(
        sql(
          `SELECT json_build_object('orderNo',o.order_no,'orderUserId',o.user_id,'orderTier',o.tier_code,'orderStatus',o.status,'payableFen',o.payable_fen,'currentMembershipTier',m.tier_id,'originalV2Order','PC261023095013WY57YAHB','v2Explanation','Historical activated VIP order restored for A after later SVIP upgrade; v3 uses matching SVIP target order') FROM payment_orders o JOIN memberships m ON m.user_id=o.user_id WHERE o.order_no='${order}'`,
        ),
      ),
    )
    const scenes = [
      "membership-none",
      "membership-vip",
      "membership-svip",
      "membership-offline",
      "payment-qr",
      "payment-success",
      "purchase-history",
      "landing-pricing",
      "account",
      "admin-tiers",
      "admin-tier-editor",
      "admin-orders",
      "admin-order-detail",
      "admin-members",
      "admin-grant",
      "admin-payment-settings",
      "admin-grant-bottom",
      "purchase-history-bottom",
      "admin-payment-settings-bottom",
    ] as const
    const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    const revision = process.env["MEMBERSHIP_CAPTURE_REVISION"] ?? "capture-v1"
    const captureRoot = resolve(evidence, revision)
    mkdirSync(captureRoot, { recursive: true })
    const manifest: {
      scene: string
      width: number
      theme: string
      file: string
      metrics: Awaited<ReturnType<typeof captureCell>>
      note?: string
    }[] = existsSync(resolve(captureRoot, "manifest.json"))
      ? JSON.parse(readFileSync(resolve(captureRoot, "manifest.json"), "utf8")).cells
      : []
    for (const scene of scenes) {
      if (scene === "membership-offline") await setTierEnabled(admin, vip, false)
      try {
        for (const width of [375, 768, 1280])
          for (const theme of ["light", "dark"] as const) {
            if (
              manifest.some(
                (cell) => cell.scene === scene && cell.width === width && cell.theme === theme,
              )
            )
              continue
            const isAdmin = scene.startsWith("admin-")
            const stateKey =
              scene === "membership-none" || scene === "payment-qr"
                ? "none"
                : scene === "membership-vip"
                  ? "vip"
                  : scene === "membership-svip"
                    ? "svip"
                    : scene === "membership-offline"
                      ? "offline"
                      : "main"
            const context = await ownedContext(browser, {
              viewport: { width, height: 1000 },
              colorScheme: theme,
              timezoneId: "Asia/Shanghai",
              ...(scene === "landing-pricing"
                ? {}
                : { storageState: isAdmin ? adminState : states.get(stateKey) }),
            })
            const page = await context.newPage()
            const diagnostics = { pageErrors: 0, runtimeConsoleErrors: 0 }
            page.on("pageerror", () => {
              diagnostics.pageErrors += 1
            })
            page.on("console", (message) => {
              if (
                message.type() === "error" &&
                /hydration|uncaught|runtime error|react.*error/i.test(message.text())
              )
                diagnostics.runtimeConsoleErrors += 1
            })
            const origin = isAdmin ? config.admin : config.home
            const path =
              scene === "landing-pricing"
                ? "/"
                : scene === "account"
                  ? "/dashboard"
                  : scene === "admin-tiers" || scene === "admin-tier-editor"
                    ? "/tiers"
                    : scene === "admin-orders" || scene === "admin-order-detail"
                      ? "/orders"
                      : scene === "admin-members" || scene.startsWith("admin-grant")
                        ? "/membership"
                        : scene.startsWith("admin-payment-settings")
                          ? "/settings?panel=payment"
                          : "/membership"
            await goto(page, `${origin}${path}`)
            await expect(
              page.getByRole("button", { name: "切换主题", exact: true }).first(),
            ).toBeVisible()
            await setTheme(page, theme)
            let note: string | undefined
            let reachability: object | undefined
            if (
              scene.startsWith("membership-") ||
              scene === "payment-qr" ||
              scene.startsWith("purchase-history")
            ) {
              await expect(page.getByRole("radiogroup", { name: "会员等级" })).toBeVisible()
              if (scene === "payment-qr") {
                await page
                  .getByRole("radiogroup", { name: "会员等级" })
                  .getByRole("radio", { name: /^VIP\b/ })
                  .click()
                await page
                  .getByRole("radiogroup", { name: "购买时长" })
                  .getByRole("radio", { name: /^1 个月/ })
                  .click()
                await page.getByRole("button", { name: "立即开通", exact: true }).click()
                await expect(page.getByLabel("付款二维码")).toBeVisible()
              } else if (scene.startsWith("purchase-history")) {
                await page.getByRole("button", { name: "购买记录", exact: true }).click()
                await expect(page.locator("li").filter({ hasText: "已生效" }).first()).toBeVisible()
                await page
                  .getByRole("button", { name: "购买记录", exact: true })
                  .scrollIntoViewIfNeeded()
                if (scene === "purchase-history-bottom") {
                  const rows = page.locator("li").filter({ hasText: "已生效" })
                  await rows.last().evaluate((el) => el.scrollIntoView({ block: "center" }))
                  await expect(rows.last().locator("time")).toBeInViewport()
                  const row = await rows.last().boundingBox()
                  const checkout = await page.getByRole("region", { name: "结算" }).boundingBox()
                  expect(
                    row &&
                      checkout &&
                      (row.y + row.height <= checkout.y || row.y >= checkout.y + checkout.height),
                  ).toBe(true)
                  const dates = await rows.locator("time").allTextContents()
                  for (const date of dates) expect(date).toMatch(/^\d{4}-\d{2}-\d{2} /)
                  reachability = {
                    records: await rows.count(),
                    dates,
                    lastRow: row,
                    checkout,
                    loadMoreVisible:
                      (await page.getByRole("button", { name: "加载更多", exact: true }).count()) >
                      0,
                    paginationReason:
                      "Actual A history has three records below server page size ten",
                  }
                  note =
                    "Supplemental purchase records/date view; last row does not overlap sticky checkout; actual cursor has no next page"
                }
              }
            } else if (scene === "payment-success") {
              await page.clock.install()
              await goto(page, `${config.home}/membership?order=${order}`)
              await expect(
                page
                  .getByRole("dialog", { name: "会员支付" })
                  .getByRole("status")
                  .filter({ hasText: "已生效" }),
              ).toBeVisible()
              await page.clock.pauseAt(new Date(Date.now() + 100))
              note =
                "Real activated owned order, return-only restoration, browser clock paused for capture; separate real-time auto-close proof"
            } else if (scene === "landing-pricing") {
              await expect(
                page.locator("#pricing").getByRole("radiogroup", { name: "会员等级" }),
              ).toBeVisible()
              await page.locator("#pricing").scrollIntoViewIfNeeded()
            } else if (scene === "account") {
              await expect(
                page.getByRole("heading", { name: "账户概览", exact: true }),
              ).toBeVisible()
            } else if (scene === "admin-tiers" || scene === "admin-tier-editor") {
              await expect(
                page.getByRole("button", { name: "编辑 VIP", exact: true }),
              ).toBeVisible()
              if (scene === "admin-tier-editor") {
                await page.getByRole("button", { name: "编辑 VIP", exact: true }).click()
                await expect(page.getByRole("region", { name: "用户端预览" })).toBeVisible()
                await expect(page.getByText("现价 ¥270.00", { exact: true })).toBeVisible()
              }
            } else if (scene === "admin-orders" || scene === "admin-order-detail") {
              await expect(
                page
                  .getByRole("region", { name: "订单统计" })
                  .getByText("今日实收", { exact: true }),
              ).toBeVisible()
              await expect(page.locator("tbody tr").first()).toBeVisible()
              if (scene === "admin-order-detail") {
                await page.getByLabel("搜索订单", { exact: true }).fill(order)
                const response = page.waitForResponse(
                  (r) => r.url().includes("/admin/v1/payment/orders?") && r.url().includes(order),
                )
                await page.getByRole("button", { name: "搜索", exact: true }).click()
                await response
                await page.locator("tbody tr").first().click()
                await expect(
                  page.getByRole("dialog", { name: /^订单详情/ }).getByText(order, { exact: true }),
                ).toBeVisible()
              }
            } else if (scene === "admin-members" || scene.startsWith("admin-grant")) {
              await expect(
                page.getByRole("button", { name: "人工授予", exact: true }),
              ).toBeVisible()
              if (scene.startsWith("admin-grant")) {
                await openGrant(page, `${config.runId}-main@example.test`)
                if (scene === "admin-grant-bottom") {
                  await page.keyboard.press("Tab")
                  await page.keyboard.press("Tab")
                  const confirm = page.getByRole("button", { name: "确认授予", exact: true })
                  await expect(confirm).toBeFocused()
                  await confirm.scrollIntoViewIfNeeded()
                  await expect(confirm).toBeInViewport()
                  await expect(page.getByRole("region", { name: "授予时间线" })).toBeInViewport()
                  reachability = {
                    keyboardTabReachedConfirm: true,
                    confirm: await confirm.boundingBox(),
                    timeline: await page.getByRole("region", { name: "授予时间线" }).boundingBox(),
                    submitted: false,
                  }
                  note =
                    "Supplemental real internal scroll to timeline and keyboard-reachable footer; no grant submitted"
                }
              } else await expect(page.locator("tbody tr").first()).toBeVisible()
            } else if (scene.startsWith("admin-payment-settings")) {
              await expect(page.getByText("已配置 · 留空则不修改", { exact: true })).toBeVisible()
              expect(await page.locator('input[type="password"]').count()).toBe(0)
              if (scene === "admin-payment-settings-bottom") {
                const callback = page.getByLabel("回调站点地址", { exact: true })
                await page
                  .getByRole("button", { name: "最新记录", exact: true })
                  .scrollIntoViewIfNeeded()
                await expect(callback).toBeInViewport()
                await expect(
                  page.getByRole("heading", { name: "变更历史", exact: true }),
                ).toBeInViewport()
                reachability = {
                  callback: await callback.boundingBox(),
                  history: await page
                    .getByRole("heading", { name: "变更历史", exact: true })
                    .boundingBox(),
                  latest: await page
                    .getByRole("button", { name: "最新记录", exact: true })
                    .boundingBox(),
                  passwordNodes: 0,
                }
                note =
                  "Supplemental actual payment callback and history lower section, no configuration write"
              }
            }
            const file = resolve(captureRoot, `${scene}--${width}--${theme}.png`)
            const metrics = {
              ...(await captureCell(page, file, diagnostics)),
              ...(reachability ? { reachability } : {}),
            }
            manifest.push({ scene, width, theme, file, metrics, ...(note ? { note } : {}) })
            writeFileSync(
              resolve(captureRoot, "manifest.json"),
              JSON.stringify(
                {
                  runId: config.runId,
                  source,
                  revision,
                  capturedAt: new Date().toISOString(),
                  cells: manifest,
                },
                null,
                2,
              ),
            )
            await context.close()
          }
      } finally {
        if (scene === "membership-offline") await setTierEnabled(admin, vip, true)
      }
    }
    expect(manifest).toHaveLength(114)
    record("96-matrix", {
      runId: config.runId,
      source,
      manifest: resolve(captureRoot, "manifest.json"),
      count: 96,
      supplementalScrollViews: 18,
      totalImages: manifest.length,
    })
    // 确认读回文件仍是本轮业务来源，禁止静态伪造矩阵。
    expect(
      JSON.parse(readFileSync(resolve(evidence, "database-and-browser.json"), "utf8"))[
        "07-native-entitlement"
      ],
    ).toBeTruthy()
    await setup.close()
  } finally {
    await canary?.close()
  }
})
