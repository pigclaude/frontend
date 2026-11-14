// 负责文件面板的视觉回归：在演示工作台里截宽面板的空状态、Markdown 预览、源码和只看改动，
// 以及窄面板只显示目录导航、选中文件后只显示文件内容，浅色和深色各一套。文件树带 Git 装饰。
import { expect, test, type Locator, type Page } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

async function openFiles(page: Page, theme: "light" | "dark"): Promise<Locator> {
  await page.clock.install({ time: FIXED_TIME })
  await page.goto(`/?screen=chat-new&theme=${theme}&glass=0&workbench=1`)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
  await page.getByRole("button", { name: "切换右侧面板", exact: true }).click()
  const panel = page.locator(".right-panel-slot")
  await panel.getByRole("button", { name: "文件", exact: true }).click()
  await expect(panel.getByRole("treeitem", { name: "README.md" })).toBeVisible()
  return panel
}

async function openSource(panel: Locator): Promise<void> {
  await panel.getByRole("treeitem", { name: "src" }).click()
  await panel.getByRole("treeitem", { name: "app.ts" }).click()
  await expect(panel.locator(".code-layer .tok").first()).toBeVisible()
}

for (const theme of ["light", "dark"] as const) {
  test(`workbench files ${theme}`, async ({ page }) => {
    const panel = await openFiles(page, theme)
    await expect(panel.getByText("从目录中选择一个文件")).toBeVisible()
    await expect(page).toHaveScreenshot(`workbench-files-empty-${theme}.png`, options)

    await panel.getByRole("treeitem", { name: "README.md" }).click()
    await expect(panel.locator(".file-markdown-preview pre .tok").first()).toBeVisible()
    await expect(page).toHaveScreenshot(`workbench-files-markdown-${theme}.png`, options)

    await openSource(panel)
    await expect(page).toHaveScreenshot(`workbench-files-source-${theme}.png`, options)

    await panel.getByRole("button", { name: "仅显示变更文件", exact: true }).click()
    await expect(panel.getByRole("treeitem", { name: "README.md" })).toHaveCount(0)
    await expect(page).toHaveScreenshot(`workbench-files-changed-${theme}.png`, options)
  })

  test(`workbench files narrow ${theme}`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("pigclaude.rightWidth", "340"))
    const panel = await openFiles(page, theme)
    await expect(panel.locator(".file-view-content")).toBeHidden()
    await expect(page).toHaveScreenshot(`workbench-files-narrow-navigation-${theme}.png`, options)

    await openSource(panel)
    await expect(panel.getByRole("treeitem")).toHaveCount(0)
    await expect(page).toHaveScreenshot(`workbench-files-narrow-file-${theme}.png`, options)
  })
}
