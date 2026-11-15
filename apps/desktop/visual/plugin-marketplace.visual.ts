// 检查市场目录、来源管理以及更新时额外申请的视觉排版。

import { expect, test, type Page } from "@playwright/test"
import { installPluginMarketplacePreview } from "./plugin-marketplace-fixture"

const screenshot = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

async function openMarketplace(page: Page, theme: "light" | "dark") {
  await installPluginMarketplacePreview(page)
  await page.clock.install({ time: new Date("2026-11-15T04:00:00Z") })
  await page.goto(`/?screen=plugins&theme=${theme}`)
  await page.getByRole("radio", { name: "插件市场" }).click()
  await expect(page.getByRole("heading", { name: "团队工具目录" })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

test("plugin marketplace catalog and managed sources", async ({ page }) => {
  await openMarketplace(page, "light")
  await expect(page.getByRole("button", { name: "安装 发布指南" })).toBeVisible()
  await expect(page.getByRole("button", { name: "更新 文档索引" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "研发归档" })).toHaveCount(0)
  await expect(page).toHaveScreenshot("plugin-marketplace-light.png", screenshot)

  await page.getByRole("button", { name: "市场源" }).click()
  const sources = page.getByRole("dialog", { name: "市场源" })
  await expect(sources.getByText("研发归档")).toBeVisible()
  await expect(sources.getByText("已停用")).toBeVisible()
  await expect(page).toHaveScreenshot("plugin-marketplace-sources-light.png", screenshot)
  await sources.getByRole("button", { name: "更换 研发归档 的版本" }).click()
  const pin = page.getByRole("dialog", { name: "更换市场源版本" })
  await expect(pin.getByLabel("SHA-256 校验值")).toHaveValue("b".repeat(64))
  await expect(pin.getByRole("button", { name: "保存并刷新" })).toBeDisabled()
  await pin.getByLabel("SHA-256 校验值").fill("c".repeat(64))
  await expect(pin.getByRole("button", { name: "保存并刷新" })).toBeEnabled()
})

test("plugin marketplace update expansion disclosure", async ({ page }) => {
  await openMarketplace(page, "dark")
  await page.getByRole("button", { name: "更新 文档索引" }).click()
  const disclosure = page.getByRole("dialog", { name: "更新披露" })
  await expect(disclosure.getByText("新增权限")).toBeVisible()
  await expect(disclosure.getByText("新增域名")).toBeVisible()
  await expect(disclosure.getByRole("button", { name: "确认更新" })).toBeVisible()
  await expect(page).toHaveScreenshot("plugin-marketplace-update-dark.png", screenshot)
})
