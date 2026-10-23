// 负责真实矩阵的主题、管理员写入和截图测量；认证状态仅保留在内存。
import { expect, type Page } from "@playwright/test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { Tier, TierInput } from "@pigclaude/api/membership/types"
/** 真实切换应用主题，刷新验证主题存储和最终DOM。 */
export async function setTheme(page: Page, theme: "light" | "dark") {
  const current = await page.locator("html").getAttribute("data-theme")
  if ((current === "light") !== (theme === "light"))
    await page.getByRole("button", { name: "切换主题", exact: true }).first().click()
  if ((await page.evaluate(() => localStorage.getItem("pigclaude-theme"))) !== theme) {
    await page.getByRole("button", { name: "切换主题", exact: true }).first().click()
    await page.getByRole("button", { name: "切换主题", exact: true }).first().click()
  }
  await page.reload()
  await expect
    .poll(() => page.locator("html").getAttribute("data-theme"))
    .toBe(theme === "light" ? "light" : null)
  expect(await page.evaluate(() => localStorage.getItem("pigclaude-theme"))).toBe(theme)
}
/** 使用正式管理员会话CSRF提交严格DTO，不读取或记录秘密。 */
export async function adminWrite(page: Page, path: string, body: object, method = "POST") {
  const response = await page.evaluate(
    async ({ path, body, method }) => {
      const session = (await (await fetch("/admin/v1/session")).json()) as { csrf: string }
      const result = await fetch(path, {
        method,
        headers: { "content-type": "application/json", "X-CSRF-Token": session.csrf },
        body: JSON.stringify(body),
      })
      return { status: result.status, body: (await result.json()) as unknown }
    },
    { path, body, method },
  )
  expect(response.status).toBe(200)
  return response.body
}
/** 保留等级及档位身份，仅通过正式API切换上架状态。 */
export async function setTierEnabled(page: Page, tier: Tier, enabled: boolean) {
  const input: TierInput = {
    name: tier.name,
    level: tier.level,
    monthlyPriceFen: tier.monthlyPriceFen,
    tagline: tier.tagline,
    cardStyle: tier.cardStyle,
    benefits: tier.benefits,
    enabled,
    options: tier.options.map(
      ({ id, months, discountKind, discountValue, badge, recommended, enabled }) => ({
        id,
        months,
        discountKind,
        discountValue,
        badge,
        recommended,
        enabled,
      }),
    ),
  }
  return adminWrite(page, `/admin/v1/membership/tiers/${tier.id}`, input, "PUT")
}
/** 每张截图保存真实主题、横向布局、隐藏原生桥接节点和hash。 */
export async function captureCell(
  page: Page,
  path: string,
  diagnostics: { pageErrors: number; runtimeConsoleErrors: number },
) {
  await page.evaluate(() => document.fonts.ready)
  const metrics = await page.evaluate(() => {
    const visibleNative = [...document.querySelectorAll("select,input[type=checkbox]")].filter(
      (el) => {
        const rect = el.getBoundingClientRect()
        const css = getComputedStyle(el)
        return (
          rect.width > 2 &&
          rect.height > 2 &&
          css.opacity !== "0" &&
          css.visibility !== "hidden" &&
          css.display !== "none"
        )
      },
    ).length
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      theme: document.documentElement.getAttribute("data-theme") ?? "dark",
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      visibleNative,
    }
  })
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  expect(metrics.visibleNative).toBe(0)
  expect(diagnostics.pageErrors).toBe(0)
  expect(diagnostics.runtimeConsoleErrors).toBe(0)
  const errorOverlayCount = await page.evaluate(() =>
    [...document.querySelectorAll("nextjs-portal")].reduce(
      (count, portal) =>
        count +
        (portal.shadowRoot?.querySelectorAll(
          '[data-nextjs-dialog-overlay], [data-nextjs-error-overlay], [data-next-badge][data-error="true"]',
        ).length ?? 0),
      0,
    ),
  )
  expect(errorOverlayCount).toBe(0)
  const screenshotStyle = '[data-next-badge][data-error="false"] { visibility: hidden !important; }'
  await page.screenshot({ path, animations: "disabled", style: screenshotStyle })
  return {
    ...metrics,
    diagnostics: { ...diagnostics, errorOverlayCount },
    screenshotStyle,
    screenshotStyleReason:
      "F50 exact non-error Next development badge only; runtime/error overlays remain visible",
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }
}
/** 填好真实授予预览但不提交，用于对话框矩阵。 */
export async function openGrant(page: Page, email: string) {
  await page.getByRole("button", { name: "人工授予", exact: true }).click()
  await page.getByRole("button", { name: "选择用户", exact: true }).click()
  await page.getByRole("combobox", { name: "搜索用户邮箱或 ID" }).fill(email)
  await page.getByRole("option").filter({ hasText: email }).click()
  await page
    .getByRole("radiogroup", { name: "授予等级" })
    .getByRole("radio", { name: /^SVIP/ })
    .click()
  await page.getByLabel("时长", { exact: true }).fill("7")
  await page
    .getByRole("radiogroup", { name: "时长单位" })
    .getByRole("radio", { name: "天", exact: true })
    .click()
  await page.getByLabel("授予价值（元）", { exact: true }).fill("0")
  await page.getByLabel("操作备注", { exact: true }).fill("Task15 visual preview only")
  await expect(page.getByRole("region", { name: "授予时间线" })).toContainText("生效后：SVIP")
  await expect(page.getByRole("button", { name: "确认授予", exact: true })).toBeEnabled()
}
