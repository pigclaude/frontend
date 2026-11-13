// 负责验证 960px 断点下的 Pigcode 抽屉：遮罩、Esc 和侧栏按钮都能关闭抽屉。
import { expect, test, type Page } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
}

for (const theme of ["light", "dark"] as const) {
  test(`narrow shell drawer ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 })
    await page.clock.install({ time: FIXED_TIME })
    await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
    await settle(page)

    const app = page.locator(".app")
    const toggle = page.getByRole("button", { name: "展开侧栏", exact: true })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(app).toHaveClass(/is-drawer-open/)
    await expect(page.locator(".drawer-scrim")).toBeVisible()
    await expect(page).toHaveScreenshot(`shell-narrow-${theme}.png`, options)

    await page.keyboard.press("Escape")
    await expect(app).not.toHaveClass(/is-drawer-open/)
    await toggle.click()
    await page.locator(".drawer-scrim").click({ position: { x: 590, y: 400 } })
    await expect(app).not.toHaveClass(/is-drawer-open/)
  })
}
