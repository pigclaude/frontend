// 以当前owned真实页面补证历史订单语义、复制降级、轨道几何与减少动态效果；控制响应明确分列。
import { expect, type Page } from "@playwright/test"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "./oauth-oidc-owned-browser"
import {
  ownedContext,
  config,
  evidence,
  goto,
  login,
  sql,
  record,
} from "./membership-local-support"
import { captureCell, setTheme } from "./membership-visual-support"
function diagnosticsFor(page: Page) {
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
  return diagnostics
}
test.setTimeout(120_000)
test("historical fulfillment never replays current activation and labels inactive state", async ({
  browser,
}) => {
  const files: object[] = []
  const folder = resolve(evidence, "extra-proofs-v2")
  mkdirSync(folder, { recursive: true })
  const order = sql(
    `SELECT o.order_no FROM payment_orders o JOIN users u ON u.id=o.user_id WHERE u.email='${config.runId}-main@example.test' AND o.status='activated' ORDER BY o.created_at LIMIT 1`,
  )
  for (const status of ["active", "expired", "revoked", "none"] as const) {
    const context = await ownedContext(browser, {
      viewport: { width: 375, height: 1000 },
      colorScheme: "light",
    })
    try {
      const page = await context.newPage()
      const diagnostics = diagnosticsFor(page)
      await login(page, `${config.runId}-main@example.test`)
      const actual = (await page.evaluate(async () => (await fetch("/v1/entitlement")).json())) as {
        status: string
        tier: object | null
        remainingSeconds: string
      }
      if (status !== "active") {
        const projected = {
          ...actual,
          status,
          tier: status === "none" ? null : actual.tier,
          remainingSeconds: "0",
        }
        await page.route(`${config.home}/v1/entitlement`, (route) =>
          route.fulfill({ json: projected }),
        )
        await page.route(`${config.home}/v1/membership/quotes`, async (route) => {
          const response = await route.fetch()
          const body = (await response.json()) as object
          await route.fulfill({ response, json: { ...body, entitlement: projected } })
        })
      }
      await goto(page, `${config.home}/membership`)
      await setTheme(page, "light")
      await goto(page, `${config.home}/membership?order=${order}`)
      const panel = page.getByRole("dialog", { name: "会员支付" })
      await expect(panel.getByText("本订单已生效", { exact: true })).toBeVisible()
      await expect(
        panel.getByText(
          status === "active"
            ? "当前会员：SVIP"
            : status === "expired"
              ? "当前会员：已过期"
              : status === "revoked"
                ? "当前会员：已撤销"
                : "当前会员：未开通",
          { exact: true },
        ),
      ).toBeVisible()
      expect(await panel.getByText("VIP 已生效", { exact: true }).count()).toBe(0)
      const currentCard = (await page.locator('[data-glint="true"]').count())
        ? await page.locator('[data-glint="true"]').first().elementHandle()
        : null
      const file = resolve(folder, `historical-${status}--375--light.png`)
      files.push({
        state: status,
        file,
        ...(await captureCell(page, file, diagnostics)),
        source:
          status === "active"
            ? "Real formal VIP order and fresh current SVIP entitlement"
            : "Controlled exact-origin entitlement/quotes projection over actual owned VIP activated order, no database writes",
      })
      await expect(panel).toHaveCount(0)
      expect(await page.locator('[data-sonner-toast][data-type="success"]').count()).toBe(0)
      if (currentCard) expect(await currentCard.evaluate((el) => el.isConnected)).toBe(true)
      record(`F54-historical-${status}`, {
        orderNo: order,
        currentStatus: status,
        frozenTier: "VIP",
        currentTier: status === "active" ? "SVIP" : null,
        noActivationToast: true,
        noGlintRemount: true,
        browserClockControlled: false,
        source:
          status === "active"
            ? "actual fresh API"
            : "controlled exact-origin read-only response projection",
      })
    } finally {
      await context.close()
    }
  }
  writeFileSync(
    resolve(folder, "historical-manifest.json"),
    JSON.stringify({ runId: config.runId, files }, null, 2),
  )
})
test("track reduction removes scale and success drawing while preserving keyboard selection", async ({
  browser,
}) => {
  const context = await ownedContext(browser, {
    viewport: { width: 375, height: 1000 },
    reducedMotion: "reduce",
  })
  try {
    const page = await context.newPage()
    const diagnostics = diagnosticsFor(page)
    await login(page, `${config.runId}-visual-none@example.test`)
    await goto(page, `${config.home}/membership`)
    const group = page.getByRole("radiogroup", { name: "会员等级", exact: true })
    await expect(group).toBeVisible()
    const radios = group.getByRole("radio")
    const transforms = await radios.evaluateAll((nodes) =>
      nodes.map((el) => getComputedStyle(el).transform),
    )
    expect(transforms).toEqual(["none", "none"])
    await radios.first().focus()
    await radios.first().press("ArrowRight")
    await expect(radios.nth(1)).toBeFocused()
    await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true")
    const geometry = await group.evaluate((el) => {
      const card = el.querySelector('[aria-checked="true"]')?.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      return {
        selectedLeft: card?.left ?? -1,
        selectedRight: card?.right ?? -1,
        left: box.left,
        right: box.right,
        snap: getComputedStyle(el).scrollSnapType,
      }
    })
    expect(geometry.selectedLeft).toBeGreaterThanOrEqual(geometry.left)
    expect(geometry.selectedRight).toBeLessThanOrEqual(geometry.right)
    expect(diagnostics.pageErrors).toBe(0)
    expect(diagnostics.runtimeConsoleErrors).toBe(0)
    record("I1-M2-reduced-track", { transforms, geometry, prefersReducedMotion: true, diagnostics })
    const successContext = await ownedContext(browser, {
      viewport: { width: 375, height: 1000 },
      reducedMotion: "reduce",
    })
    try {
      const successPage = await successContext.newPage()
      const successDiagnostics = diagnosticsFor(successPage)
      await login(successPage, `${config.runId}-main@example.test`)
      const order = sql(
        `SELECT o.order_no FROM payment_orders o JOIN users u ON u.id=o.user_id WHERE u.email='${config.runId}-main@example.test' AND o.status='activated' ORDER BY o.created_at LIMIT 1`,
      )
      await goto(successPage, `${config.home}/membership?order=${order}`)
      await expect(successPage.getByText("本订单已生效", { exact: true })).toBeVisible()
      const drawing = await successPage
        .locator(".membership-success-check path")
        .evaluate((el) => ({
          animation: getComputedStyle(el).animationName,
          dashoffset: getComputedStyle(el).strokeDashoffset,
        }))
      expect(drawing).toEqual({ animation: "none", dashoffset: "0px" })
      expect(successDiagnostics.pageErrors).toBe(0)
      expect(successDiagnostics.runtimeConsoleErrors).toBe(0)
      record("M1-reduced-success-drawing", { drawing, diagnostics: successDiagnostics })
    } finally {
      await successContext.close()
    }
  } finally {
    await context.close()
  }
})
test("history clipboard rejection and absence provide a selectable full owned order", async ({
  browser,
}) => {
  const folder = resolve(evidence, "extra-proofs-v2")
  mkdirSync(folder, { recursive: true })
  for (const kind of ["reject", "missing"] as const) {
    const context = await ownedContext(browser, { viewport: { width: 375, height: 1000 } })
    try {
      const page = await context.newPage()
      const diagnostics = diagnosticsFor(page)
      await login(page, `${config.runId}-main@example.test`)
      await page.route(`${config.home}/v1/membership/orders?*`, async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as { items: { orderNo: string; status: string }[] }
        await route.fulfill({
          response,
          json: { ...body, items: body.items.map((item) => ({ ...item, status: "needs_review" })) },
        })
      })
      await page.addInitScript(
        (kind) =>
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value:
              kind === "missing"
                ? undefined
                : {
                    writeText: async () => {
                      throw new Error("controlled clipboard denial")
                    },
                  },
          }),
        kind,
      )
      await goto(page, `${config.home}/membership`)
      await page.getByRole("button", { name: "购买记录", exact: true }).click()
      await page.getByRole("button", { name: "复制单号", exact: true }).click()
      const input = page.getByRole("textbox", { name: "完整单号", exact: true })
      await expect(input).toBeVisible()
      await input.focus()
      const selection = await input.evaluate((el) => {
        const input = el as HTMLInputElement
        return { value: input.value, start: input.selectionStart, end: input.selectionEnd }
      })
      expect(selection.value).toMatch(/^PC[0-9A-Z]{20}$/)
      expect(selection.start).toBe(0)
      expect(selection.end).toBe(selection.value.length)
      await input.scrollIntoViewIfNeeded()
      const file = resolve(folder, `history-copy-${kind}--375--dark.png`)
      record(`M4-copy-${kind}`, {
        source:
          "Actual own history row with controlled exact-origin needs_review projection and browser clipboard capability denial; no DB writes",
        selection,
        file,
        ...(await captureCell(page, file, diagnostics)),
      })
    } finally {
      await context.close()
    }
  }
})
