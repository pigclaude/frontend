// 检查市场目录、来源管理以及更新时额外申请的视觉排版。

import { expect, test, type Page } from "@playwright/test"
import { installPluginMarketplacePreview } from "./plugin-marketplace-fixture"

const screenshot = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

async function openMarketplace(
  page: Page,
  theme: "light" | "dark",
  enabled = true,
  official = false,
) {
  await installPluginMarketplacePreview(page, enabled, official)
  await page.clock.install({ time: new Date("2026-11-15T04:00:00Z") })
  await page.goto(`/?screen=plugins&theme=${theme}`)
  await page.getByRole("radio", { name: "插件市场" }).click()
  const state = official
    ? page.getByRole("heading", { name: "PigClaude 官方目录" })
    : enabled
      ? page.getByRole("heading", { name: "团队工具目录" })
      : page.getByText("第三方市场已关闭", { exact: true })
  await expect(state).toBeVisible()
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
  await expect(disclosure.getByText("插件包文件指纹已变化", { exact: false })).toBeVisible()
  await expect(disclosure.getByRole("button", { name: "确认更新" })).toBeVisible()
  await expect(page).toHaveScreenshot("plugin-marketplace-update-dark.png", screenshot)
})

test("plugin marketplace third-party consent", async ({ page }) => {
  await openMarketplace(page, "light", false)
  await expect(page.getByRole("switch", { name: "第三方市场" })).not.toBeChecked()
  await expect(page.getByRole("button", { name: "安装 发布指南" })).toHaveCount(0)
  await expect(page).toHaveScreenshot("plugin-marketplace-third-party-off-light.png", screenshot)
  await page.getByRole("switch", { name: "第三方市场" }).click()
  const consent = page.getByRole("dialog", { name: "开启第三方市场？" })
  await expect(consent.getByText("未经 PigClaude 审核", { exact: false })).toBeVisible()
  await expect(consent.getByRole("button", { name: "开启第三方市场" })).toBeVisible()
  await expect(page).toHaveScreenshot(
    "plugin-marketplace-third-party-consent-light.png",
    screenshot,
  )
})

test("plugin marketplace official reviewed catalog and blocked entries", async ({ page }) => {
  await openMarketplace(page, "light", false, true)
  await expect(page.getByRole("switch", { name: "第三方市场" })).not.toBeChecked()
  await expect(page.getByText("官方目录已过期。", { exact: false })).toBeVisible()
  await expect(page.getByText("已审核", { exact: true })).toHaveCount(2)
  await expect(page.getByRole("button", { name: "安装 文档索引" })).toHaveCount(0)
  await expect(page).toHaveScreenshot("plugin-marketplace-official-light.png", screenshot)

  await page.getByRole("button", { name: "查看 发布指南 的市场详情" }).click()
  const detail = page.getByRole("dialog", { name: "发布指南" })
  await expect(detail.getByText("该插件已被官方吊销", { exact: false })).toBeVisible()
  await expect(page).toHaveScreenshot("plugin-marketplace-official-blocked-light.png", screenshot)
})
