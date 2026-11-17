// 检查市场目录、来源管理以及更新时额外申请的视觉排版。

import { expect, test, type Page } from "@playwright/test"
import { expectControlHeights } from "./control-heights"
import { installPluginMarketplacePreview } from "./plugin-marketplace-fixture"

const screenshot = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

async function openMarketplace(
  page: Page,
  theme: "light" | "dark",
  enabled = true,
  official?: "active" | "expired",
) {
  await installPluginMarketplacePreview(page, enabled, official)
  await page.clock.install({ time: new Date("2026-11-15T04:00:00Z") })
  await page.goto(`/?screen=plugins&theme=${theme}`)
  await expect(page.getByRole("radio", { name: "公开" })).toBeChecked()
  if (!official) await page.getByRole("radio", { name: "个人" }).click()
  const state =
    official === "active"
      ? page.getByRole("heading", { name: "开发者工具" })
      : official === "expired"
        ? page.getByText("官方目录已过期。", { exact: false })
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
  await expect(page.getByText("为项目文档提供检索工具")).toBeVisible()
  await expect(page.getByRole("heading", { name: "研发归档" })).toHaveCount(0)
  await expect(page).toHaveScreenshot("plugin-marketplace-light.png", screenshot)

  const search = page.getByPlaceholder("搜索市场插件")
  await search.fill("审查命令")
  await expect(page.getByRole("button", { name: "安装 发布指南" })).toBeVisible()
  await expect(page.getByRole("button", { name: "更新 文档索引" })).toHaveCount(0)
  await search.fill("")
  await search.blur()
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

test("marketplace controls align and catalog columns adapt as the window narrows", async ({
  page,
}) => {
  await openMarketplace(page, "light")
  const header = page.locator(".plugins-header")
  const tabs = page.getByRole("radiogroup", { name: "插件目录" })
  const search = page.locator(".marketplace-catalog .market-search")
  const tiles = page.locator(".marketplace-catalog .market-tile")
  for (const width of [1200, 620, 360]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(async () => {
      const [bounds, tabBounds, searchBounds, firstTile, secondTile] = await Promise.all([
        header.boundingBox(),
        tabs.boundingBox(),
        search.boundingBox(),
        tiles.nth(0).boundingBox(),
        tiles.nth(1).boundingBox(),
      ])
      if (!bounds || !tabBounds || !searchBounds) throw new Error("插件页头部未显示")
      if (!firstTile || !secondTile) throw new Error("市场目录条目未显示")
      expect(Math.abs(tabBounds.x - bounds.x), `${width}px 左边距`).toBeLessThan(1)
      expect(tabBounds.y).toBeGreaterThan(bounds.y + bounds.height)
      expect(
        Math.abs(searchBounds.x + searchBounds.width - bounds.x - bounds.width),
        `${width}px 右边距`,
      ).toBeLessThan(1)
      if (width === 1200) {
        expect(firstTile.y).toBe(secondTile.y)
        expect(secondTile.x).toBeGreaterThan(firstTile.x + firstTile.width)
      }
      if (width === 360) {
        expect(searchBounds.y).toBeGreaterThan(tabBounds.y + tabBounds.height)
        expect(firstTile.x).toBe(secondTile.x)
        expect(secondTile.y).toBeGreaterThan(firstTile.y + firstTile.height)
      }
    }).toPass({ timeout: 2500 })
  }
})

test("plugin marketplace scopes and independent management preserve browsing state", async ({
  page,
}) => {
  await openMarketplace(page, "light", true, "active")
  await expect(page.getByRole("button", { name: "安装 项目索引" })).toBeVisible()
  await expect(page.getByRole("button", { name: "安装 测试报告" })).toHaveCount(0)
  await expectControlHeights(32, [
    page.getByRole("button", { name: "插件管理", exact: true }),
    page.getByRole("button", { name: "刷新市场", exact: true }),
    page.getByRole("button", { name: "市场源", exact: true }),
    page.getByRole("button", { name: "添加", exact: true }),
  ])
  await expectControlHeights(36, [page.locator(".market-search")])
  await expectControlHeights(28, [
    page.getByRole("radiogroup", { name: "插件目录" }),
    page.getByRole("button", { name: "安装 项目索引", exact: true }),
  ])
  await expect(page).toHaveScreenshot("plugin-marketplace-public-light.png", screenshot)

  await page.getByRole("radio", { name: "社区" }).click()
  await expect(page.getByRole("button", { name: "安装 测试报告" })).toBeVisible()
  await expect(page.getByRole("button", { name: "安装 项目索引" })).toHaveCount(0)

  await page.getByRole("radio", { name: "个人" }).click()
  await expect(page.getByRole("heading", { name: "团队工具目录" })).toBeVisible()
  const search = page.getByPlaceholder("搜索市场插件")
  await search.fill("审查命令")
  await expect(page.getByRole("button", { name: "安装 发布指南" })).toBeVisible()
  await page.getByRole("button", { name: "插件管理", exact: true }).click()
  await expect(page.getByRole("heading", { name: "插件管理" })).toBeVisible()
  await expectControlHeights(36, [page.locator(".plugin-management .market-search")])
  await expect(page.getByRole("radiogroup", { name: "插件目录" })).toHaveCount(0)
  await expect(page.getByRole("switch", { name: "启用 文档索引" })).toBeChecked()
  await expect(page.getByRole("switch", { name: "启用 项目笔记" })).not.toBeChecked()
  await expect(page).toHaveScreenshot("plugin-management-light.png", screenshot)
  await page.getByRole("button", { name: "返回插件市场" }).click()
  await expect(page.getByRole("radio", { name: "个人" })).toBeChecked()
  await expect(search).toHaveValue("审查命令")
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
  await expect(page.getByRole("switch", { name: "第三方市场" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "安装 发布指南" })).toHaveCount(0)
  await expect(page).toHaveScreenshot("plugin-marketplace-third-party-off-light.png", screenshot)
  await page.getByRole("button", { name: "管理市场源" }).click()
  const sources = page.getByRole("dialog", { name: "市场源" })
  const thirdParty = sources.getByRole("switch", { name: "第三方市场" })
  await expect(thirdParty).not.toBeChecked()
  await thirdParty.click()
  const consent = page.getByRole("dialog", { name: "开启第三方市场？" })
  await expect(consent.getByText("未经 PigClaude 审核", { exact: false })).toBeVisible()
  await expect(consent.getByRole("button", { name: "开启第三方市场" })).toBeVisible()
  await expect(page).toHaveScreenshot(
    "plugin-marketplace-third-party-consent-light.png",
    screenshot,
  )
  await consent.getByRole("button", { name: "取消" }).click()
  await sources.getByRole("button", { name: "关闭", exact: true }).last().click()
  await page.getByRole("button", { name: "添加", exact: true }).click()
  await consent.getByRole("button", { name: "开启第三方市场" }).click()
  const add = page.getByRole("dialog", { name: "添加市场源" })
  await expectControlHeights(28, [
    add.getByLabel("GitHub 仓库", { exact: true }),
    add.getByRole("button", { name: "Claude Code 插件目录" }),
  ])
  await expectControlHeights(32, [add.getByRole("button", { name: "添加市场源" })])
})

test("plugin marketplace official reviewed catalog and blocked entries", async ({ page }) => {
  await openMarketplace(page, "light", false, "expired")
  await expect(page.getByRole("switch", { name: "第三方市场" })).toHaveCount(0)
  await expect(page.getByText("官方目录已过期。", { exact: false })).toBeVisible()
  await expect(page.getByText("已审核", { exact: true })).toHaveCount(2)
  await expect(page.getByRole("button", { name: "安装 文档索引" })).toHaveCount(0)
  await expect(page).toHaveScreenshot("plugin-marketplace-official-light.png", screenshot)

  await page.getByRole("button", { name: "查看 发布指南 的市场详情" }).click()
  const detail = page.getByRole("dialog", { name: "发布指南" })
  await expect(detail.getByText("该插件已被官方吊销", { exact: false })).toBeVisible()
  await expect(page).toHaveScreenshot("plugin-marketplace-official-blocked-light.png", screenshot)
})
