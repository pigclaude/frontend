// 负责用真实后台编辑器测量卡面名称边界和选择圆点，防止可见名称裁切与重叠。
import { expect } from "@playwright/test"
import { test } from "./oauth-oidc-owned-browser"
import { config, login, goto, ownedContext, record } from "./membership-local-support"
test.setTimeout(180_000)
test("card style labels fit and avoid selection indicators", async ({ browser }) => {
  const measurements = []
  for (const width of [375, 768, 1280]) {
    const context = await ownedContext(browser, { viewport: { width, height: 1000 } })
    const page = await context.newPage()
    await login(page, "admin@example.test", true)
    await goto(page, `${config.admin}/tiers`)
    await page.getByRole("button", { name: "编辑 VIP", exact: true }).click()
    const cards = page.getByRole("radiogroup", { name: "卡面" })
    await expect(cards.getByRole("radio", { name: "obsidian", exact: true })).toBeVisible()
    const rows = await cards.getByRole("radio").evaluateAll((nodes) =>
      nodes.map((node) => {
        const card = node.getBoundingClientRect()
        const label = node.querySelector(".membership-card-name")
        const radio = node.querySelector(".membership-card-radio")
        if (!label || !radio) throw new Error("CARD_LABEL_REQUIRED")
        const text = label.getBoundingClientRect()
        const indicator = radio.getBoundingClientRect()
        return {
          name: label.textContent,
          fits:
            text.left >= card.left &&
            text.right <= card.right &&
            label.scrollWidth <= label.clientWidth,
          separated:
            text.right <= indicator.left ||
            text.left >= indicator.right ||
            text.bottom <= indicator.top ||
            text.top >= indicator.bottom,
        }
      }),
    )
    measurements.push({ width, rows })
    record("card-style-layout", measurements)
    for (const row of rows) {
      expect(row.fits, `${width} ${row.name} must fit in card`).toBe(true)
      expect(row.separated, `${width} ${row.name} must avoid indicator`).toBe(true)
    }
    await context.close()
  }
})
