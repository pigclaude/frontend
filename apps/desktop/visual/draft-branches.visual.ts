// 负责新会话草稿分支与 worktree 控件的视觉回归：演示工作台在 main 分支上，截草稿、打开的分支菜单、
// 打开 worktree 开关后选起点的菜单，浅色和深色各一套。
import { expect, test, type Page } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

async function openDraft(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.clock.install({ time: FIXED_TIME })
  await page.goto(`/?screen=chat-new&theme=${theme}&glass=0&workbench=1`)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
  // 浏览器预览没有会话服务，启动时的提示 2.4 秒后自动消失；等它消失，截图才不随时机变化。
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByRole("button", { name: "切换 Git 分支 · main" })).toBeVisible()
}

for (const theme of ["light", "dark"] as const) {
  test(`draft branches ${theme}`, async ({ page }) => {
    await openDraft(page, theme)
    await expect(page).toHaveScreenshot(`draft-branches-${theme}.png`, options)

    await page.getByRole("button", { name: "切换 Git 分支 · main" }).click()
    await expect(page.getByRole("option", { name: "feature/search" })).toBeVisible()
    await expect(page).toHaveScreenshot(`draft-branches-menu-${theme}.png`, options)
    await page.keyboard.press("Escape")
    await expect(page.locator(".draft-branch-menu")).toHaveCount(0)

    await page.locator(".draft-worktree [role='switch']").click()
    await page.getByRole("button", { name: "选择 worktree 起点 · main" }).click()
    await expect(page.getByRole("option", { name: "origin/main" })).toBeVisible()
    await expect(page).toHaveScreenshot(`draft-branches-worktree-${theme}.png`, options)
  })
}
