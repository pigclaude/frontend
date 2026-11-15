// 在浏览器里核对安装披露的权限、域名和工具，以及较长描述的排版。

import { expect, test } from "@playwright/test"
import { installPluginSettingsPreview } from "./plugin-settings-fixture"

test("local plugin installation disclosure", async ({ page }) => {
  await installPluginSettingsPreview(page)
  await page.goto("/?screen=plugins&theme=dark")
  await page.getByRole("button", { name: "从目录安装" }).click()
  const dialog = page.getByRole("dialog", { name: "安装披露" })
  await expect(dialog.getByText("读取工作区文件")).toBeVisible()
  await expect(dialog.getByText("docs.example.org")).toBeVisible()
  await expect(dialog.getByText("search_docs", { exact: true })).toBeVisible()
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()
  expect(bounds).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (bounds && viewport) {
    expect(bounds.x + bounds.width / 2).toBeCloseTo(viewport.width / 2, 0)
    expect(bounds.y + bounds.height / 2).toBeCloseTo(viewport.height / 2, 0)
  }
  await page.evaluate(() => document.fonts.ready)
  await expect(page).toHaveScreenshot("plugin-install-disclosure-dark.png", {
    threshold: 0.1,
    maxDiffPixels: 0,
    animations: "disabled",
  })
})
