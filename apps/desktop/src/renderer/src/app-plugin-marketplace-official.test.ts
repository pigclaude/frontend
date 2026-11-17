// 从真实桌面设置核对固定官方目录、有效性阻断及已安装插件的吊销状态。
// @vitest-environment jsdom

import { expect, it } from "vitest"
import type {
  PluginMarketplaceEntryView,
  PluginMarketplaceSourceView,
} from "../../plugin-marketplace-contract"
import { desktopAppRoot } from "./test-support/desktop-app-harness"
import {
  capabilityEntry,
  capabilityDisclosure,
  dialog,
  installedPlugin,
  marketEntry,
  marketplaceFixture,
  openMarketplace,
  originalSource,
  select,
} from "./test-support/plugin-marketplace-harness"

const app = desktopAppRoot()
const official: PluginMarketplaceSourceView = {
  id: "pigclaude-official",
  kind: "official",
  label: "pigclaude/plugs",
  catalogName: "PigClaude 官方目录",
  enabled: true,
  refreshedAt: "2026-11-15T01:00:00.000Z",
  entryCount: 3,
  error: null,
  pin: null,
}
const available: PluginMarketplaceEntryView = {
  ...capabilityEntry,
  sourceId: official.id,
  name: "官方索引",
  reviewStatus: "reviewed",
}
const expired: PluginMarketplaceEntryView = {
  ...available,
  id: "archive-reader",
  name: "归档阅读器",
  action: "blocked",
  blockedBy: "expired",
}
const revoked: PluginMarketplaceEntryView = {
  ...available,
  id: "legacy-reader",
  name: "旧版阅读器",
  action: "blocked",
  blockedBy: "revoked",
}

it("关闭第三方时官方仍可浏览和刷新，过期与吊销条目只可读详情", async () => {
  const f = marketplaceFixture(
    true,
    [marketEntry, available, expired, revoked],
    [official, originalSource],
    false,
  )
  await openMarketplace(app, f, "公开")
  expect(app.container.textContent).toContain("能力插件")
  expect(app.container.textContent).toContain("已审核")
  expect(app.container.textContent).not.toContain("工程手册")
  expect(app.container.querySelector('[aria-label="安装 官方索引"]')).not.toBeNull()
  expect(app.container.querySelector('[aria-label="安装 归档阅读器"]')).toBeNull()
  expect(app.container.querySelector('[aria-label="更新 归档阅读器"]')).toBeNull()

  await select("查看 归档阅读器 的市场详情", app.container, "button[aria-label]")
  expect(dialog().textContent).toContain("官方目录已过期")
  await select("关闭", dialog(), '[aria-label="关闭"]')
  await select("查看 旧版阅读器 的市场详情", app.container, "button[aria-label]")
  expect(dialog().textContent).toContain("该插件已被官方吊销")
  await select("关闭", dialog(), '[aria-label="关闭"]')
  expect(f.market.prepareInstall).not.toHaveBeenCalled()
  expect(f.market.prepareUpdate).not.toHaveBeenCalled()

  f.market.prepareInstall.mockResolvedValueOnce(capabilityDisclosure)
  await select("安装 官方索引", app.container, "button[aria-label]")
  expect(f.market.prepareInstall).toHaveBeenCalledExactlyOnceWith(official.id, available.id)
  expect(dialog().textContent).toContain("已审核")
  await select("取消", dialog())

  await select("市场源", app.container)
  expect(dialog().querySelector('[aria-label="启用 PigClaude 官方目录"]')).toBeNull()
  expect(dialog().querySelector('[aria-label="更换 PigClaude 官方目录 的版本"]')).toBeNull()
  expect(dialog().querySelector('[aria-label="删除 PigClaude 官方目录"]')).toBeNull()
  await select("刷新 PigClaude 官方目录", dialog(), "button[aria-label]")
  expect(f.market.refresh).toHaveBeenCalledExactlyOnceWith("pigclaude-official")
})

it("刷新后条目过期，自动释放已打开的安装披露", async () => {
  const f = marketplaceFixture(false, [available], [official], false)
  await openMarketplace(app, f, "公开")
  f.market.prepareInstall.mockResolvedValueOnce(capabilityDisclosure)
  f.market.list.mockResolvedValueOnce({
    developerMode: false,
    thirdPartyEnabled: false,
    sources: [official],
    entries: [{ ...available, action: "blocked", blockedBy: "expired" }],
  })
  await select("安装 官方索引", app.container, "button[aria-label]")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(f.plugins.cancel).toHaveBeenCalledExactlyOnceWith(capabilityDisclosure.confirmationId)
  expect(f.plugins.confirm).not.toHaveBeenCalled()
  expect(app.container.textContent).toContain("官方目录已过期")
})

it("第三方缓存错误单独显示，官方条目仍可见且可刷新", async () => {
  const f = marketplaceFixture(false, [available], [official])
  f.market.list.mockResolvedValue({
    developerMode: false,
    thirdPartyEnabled: true,
    thirdPartyError: "PLUGIN_MARKETPLACE_CACHE_INVALID",
    sources: [official],
    entries: [available],
  })
  await openMarketplace(app, f, "公开")
  expect(app.container.textContent).toContain("官方索引")
  expect(app.container.querySelector('.marketplace-catalog [role="alert"]')).toBeNull()
  await select("个人", app.container, '[role="radio"]')
  expect(app.container.querySelector('.marketplace-catalog [role="alert"]')?.textContent).toBe(
    "无法读取本机的第三方市场缓存。",
  )
  await select("市场源", app.container)
  expect(dialog().textContent).toContain("无法读取本机的第三方市场缓存。")
  await select("刷新 PigClaude 官方目录", dialog(), "button[aria-label]")
  expect(f.market.refresh).toHaveBeenCalledExactlyOnceWith(official.id)
})

it("无缓存的官方目录仍显示固定验签错误和刷新入口", async () => {
  const f = marketplaceFixture(
    false,
    [],
    [
      {
        ...official,
        catalogName: official.id,
        entryCount: 0,
        error: "PLUGIN_MARKETPLACE_OFFICIAL_SIGNATURE_INVALID",
      },
    ],
    false,
  )
  await openMarketplace(app, f, "公开")
  expect(app.container.textContent).toContain("官方目录签名无效")
  expect(app.container.textContent).not.toContain("PLUGIN_MARKETPLACE_OFFICIAL_SIGNATURE_INVALID")
  await select("刷新市场", app.container, "button[aria-label]")
  expect(f.market.refresh).toHaveBeenCalledExactlyOnceWith("pigclaude-official")
  await select("市场源", app.container)
  expect(dialog().textContent).toContain("PigClaude 官方目录")
})

it("刷新市场覆盖官方目录和所有启用的个人来源，并保留其它成功的刷新", async () => {
  const f = marketplaceFixture(
    false,
    [available, marketEntry],
    [official, originalSource, { ...originalSource, id: "paused-market", enabled: false }],
  )
  f.market.refresh.mockImplementation(async (id) => {
    if (id === official.id) throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE")
  })
  await openMarketplace(app, f, "公开")
  await select("刷新市场", app.container, "button[aria-label]")
  expect(f.market.refresh.mock.calls).toEqual([[official.id], [originalSource.id]])
  expect(app.container.querySelector('[role="alert"]')?.textContent).toBe(
    "无法读取官方目录，请稍后刷新。",
  )
  expect(app.container.textContent).toContain("官方索引")
})

it("吊销的已安装插件显示原因、禁止启用并保留卸载", async () => {
  const f = marketplaceFixture(false, [], [official], false)
  let records = [{ ...installedPlugin, enabled: false, revocationReason: "发布方撤回此版本。" }]
  f.plugins.list = async () => records
  f.plugins.uninstall.mockImplementationOnce(async () => {
    records = []
  })
  await openMarketplace(app, f, "公开")
  await select("插件管理", app.container)
  const toggle = app.container.querySelector('[role="switch"][aria-label="启用 本地工具"]')
  expect(toggle?.matches(':disabled, [aria-disabled="true"]')).toBe(true)
  expect(f.plugins.setEnabled).not.toHaveBeenCalled()
  await select("本地工具 的详情", app.container, "button[aria-label]")
  expect(dialog().textContent).toContain("已吊销")
  expect(dialog().textContent).toContain("发布方撤回此版本。")
  await select("卸载", dialog())
  await select("确认卸载", dialog())
  expect(f.plugins.uninstall).toHaveBeenCalledExactlyOnceWith("local-tool", false)
  expect(app.container.textContent).not.toContain("本地工具")
})
