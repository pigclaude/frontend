// 负责给每个页面在浅色、深色、有无玻璃效果下截图，并与基线逐像素比较。
import { expect, test, type Page } from "@playwright/test"
import { allScreens } from "../src/renderer/src/models/dev-view"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const
const skipped = new Set(["login", "authorize"])

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
}

test("login 未登录状态", async ({ page }) => {
  await page.goto("/")
  await settle(page)
  await expect(page).toHaveScreenshot("login.png", options)
})

for (const screen of allScreens.filter((name) => !skipped.has(name))) {
  for (const theme of ["light", "dark"] as const) {
    for (const glass of [0, 1] as const) {
      test(`${screen} ${theme} glass=${glass}`, async ({ page }) => {
        await page.goto(`/?screen=${screen}&theme=${theme}&glass=${glass}`)
        await settle(page)
        await expect(page).toHaveScreenshot(`${screen}-${theme}-${glass}.png`, options)
      })
    }
  }
}
