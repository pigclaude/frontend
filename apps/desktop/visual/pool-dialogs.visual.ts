// 验证号池的账号详情、CLI 导入和代理新增与删除弹层在浅深色下可达并保持布局。
import { expect, test } from "@playwright/test"

const screenshot = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

for (const theme of ["light", "dark"] as const) {
  test(`account detail and import dialog ${theme}`, async ({ page }) => {
    await page.goto(`/?screen=accounts&theme=${theme}`)
    await page.getByRole("button", { name: /工作 Max/ }).click()
    await expect(page.getByRole("heading", { name: "工作 Max" })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(page).toHaveScreenshot(`pool-account-detail-${theme}.png`, screenshot)
    await page.getByRole("button", { name: "账号", exact: true }).click()
    await page.getByRole("button", { name: "从 Claude CLI 导入", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "确认导入" })).toBeInViewport()
    await expect(page).toHaveScreenshot(`pool-account-import-${theme}.png`, screenshot)
  })
  test(`proxy dialogs ${theme}`, async ({ page }) => {
    await page.goto(`/?screen=proxies&theme=${theme}`)
    const dialog = page.getByRole("dialog")
    await page.getByRole("button", { name: "添加代理", exact: true }).click()
    await expect(dialog).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect(page).toHaveScreenshot(`pool-proxy-add-${theme}.png`, screenshot)
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    await page.getByRole("button", { name: "编辑 LA-01", exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(page).toHaveScreenshot(`pool-proxy-edit-${theme}.png`, screenshot)
    await dialog.getByRole("button", { name: "取消", exact: true }).click()
    await page.getByRole("button", { name: "删除 LA-01", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "确认删除", exact: true })).toBeVisible()
    await expect(page).toHaveScreenshot(`pool-proxy-delete-${theme}.png`, screenshot)
  })
}
