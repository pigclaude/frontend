// 负责给每个页面在浅色、深色、有无玻璃效果下截图，并与基线逐像素比较。
import { expect, test, type Page } from "@playwright/test"
import { allScreens } from "../src/renderer/src/models/dev-view"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const
const skipped = new Set(["login", "onboarding", "authorize"])

/**
 * 新会话页按时段问候；基线是在固定时刻截的。把浏览器时钟定在那一时刻，
 * 否则同一份代码在早上和晚上会截出不同文案。
 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: FIXED_TIME })
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
}

const variants = [
  { theme: "light", glass: 0 },
  { theme: "dark", glass: 0 },
  { theme: "light", glass: 1 },
  { theme: "dark", glass: 1 },
] as const

for (const phase of ["idle", "waiting", "confirming", "error"] as const) {
  for (const { theme, glass } of variants) {
    test(`login ${phase} ${theme} glass=${glass}`, async ({ page }) => {
      await page.goto(`/?screen=login&phase=${phase}&theme=${theme}&glass=${glass}`)
      await settle(page)
      await expect(page).toHaveScreenshot(`login-${phase}-${theme}-${glass}.png`, options)
    })
  }
}

for (const step of ["proxy", "account", "session"] as const) {
  for (const { theme, glass } of variants) {
    test(`onboarding ${step} ${theme} glass=${glass}`, async ({ page }) => {
      await page.goto(`/?screen=onboarding&step=${step}&theme=${theme}&glass=${glass}`)
      await settle(page)
      await expect(page).toHaveScreenshot(`onboarding-${step}-${theme}-${glass}.png`, options)
    })
  }
}

for (const screen of allScreens.filter((name) => !skipped.has(name))) {
  for (const theme of ["light", "dark"] as const) {
    for (const glass of [0, 1] as const) {
      test(`${screen} ${theme} glass=${glass}`, async ({ page }) => {
        await freezeClock(page)
        await page.goto(`/?screen=${screen}&theme=${theme}&glass=${glass}`)
        await settle(page)
        await expect(page).toHaveScreenshot(`${screen}-${theme}-${glass}.png`, options)
      })
    }
  }
}
