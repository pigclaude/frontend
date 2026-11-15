// 验证真实插件市场设置的默认关闭、风险确认和文件指纹变化披露。
// @vitest-environment jsdom

import { expect, it } from "vitest"
import type { PluginMarketplaceUpdateResult } from "../../plugin-marketplace-contract"
import { buttonNamed } from "./test-support/chat-screen-harness"
import { desktopAppRoot } from "./test-support/desktop-app-harness"
import {
  capabilityDisclosure,
  capabilityEntry,
  dialog,
  marketEntry,
  marketplaceFixture,
  openMarketplace,
  originalSource,
  select,
} from "./test-support/plugin-marketplace-harness"

const app = desktopAppRoot()
const label = "第三方市场"

function control(name: string, scope: ParentNode): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === name,
  )
}

it("第三方市场默认关闭，只有确认风险才开启，关闭不等待下一次读取", async () => {
  const reviewed = {
    ...marketEntry,
    id: "reviewed",
    name: "官方手册",
    reviewStatus: "reviewed",
  } as const
  const f = marketplaceFixture(
    true,
    [marketEntry, reviewed],
    [{ ...originalSource, kind: "github", pin: "a".repeat(40) }],
    false,
  )
  await openMarketplace(app, f)
  expect(app.container.textContent).not.toContain("工程手册")
  expect(app.container.textContent).toContain("官方手册")
  expect(
    app.container
      .querySelector('[role="switch"][aria-label="第三方市场"]')
      ?.getAttribute("aria-checked"),
  ).toBe("false")

  await select("市场源", app.container)
  expect(buttonNamed("添加市场源", dialog())?.disabled).toBe(true)
  expect(control("刷新 团队目录", dialog())?.disabled).toBe(true)
  expect(control("更换 团队目录 的版本", dialog())?.disabled).toBe(true)
  expect(control("删除 团队目录", dialog())?.disabled).toBe(false)
  await select("关闭", dialog(), '[aria-label="关闭"]')

  await select(label, app.container, '[role="switch"]')
  expect(dialog().textContent).toContain("未经 PigClaude 审核")
  expect(dialog().textContent).toContain("Skill")
  expect(f.market.setThirdPartyEnabled).not.toHaveBeenCalled()
  await select("取消", dialog())
  expect(f.market.setThirdPartyEnabled).not.toHaveBeenCalled()
  expect(app.container.textContent).not.toContain("工程手册")

  await select(label, app.container, '[role="switch"]')
  await select("开启第三方市场", dialog())
  expect(f.market.setThirdPartyEnabled).toHaveBeenCalledExactlyOnceWith(true)
  const entry = control("查看 工程手册 的市场详情", app.container)
  expect(entry?.textContent).toContain("未审核")
  expect(control("查看 官方手册 的市场详情", app.container)?.textContent).not.toContain("未审核")
  await select("查看 工程手册 的市场详情", app.container, "button[aria-label]")
  expect(dialog().textContent).toContain("未审核")
  await select("关闭", dialog(), '[aria-label="关闭"]')

  f.market.list.mockImplementationOnce(() => new Promise(() => undefined))
  await select(label, app.container, '[role="switch"]')
  expect(f.market.setThirdPartyEnabled.mock.calls).toEqual([[true], [false]])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(app.container.textContent).not.toContain("工程手册")
  expect(app.container.textContent).toContain("官方手册")
  await select("已安装", app.container, '[role="radio"]')
  expect(app.container.textContent).toContain("本地工具")
})

it("仅文件指纹变化也保留安装披露确认和取消", async () => {
  const f = marketplaceFixture(true, [{ ...capabilityEntry, action: "update" }])
  const result: PluginMarketplaceUpdateResult = {
    kind: "review",
    disclosure: capabilityDisclosure,
    additionalPermissions: [],
    additionalDomains: [],
    fileHashChanged: true,
  }
  f.market.prepareUpdate.mockResolvedValueOnce(result).mockResolvedValueOnce({
    ...result,
    disclosure: { ...capabilityDisclosure, confirmationId: "changed-bundle" },
  })
  await openMarketplace(app, f)
  await select("更新 度量助手", app.container, "button[aria-label]")
  expect(dialog().textContent).toContain("插件包文件指纹已变化")
  expect(dialog().textContent).not.toContain("新增权限")
  expect(dialog().textContent).not.toContain("新增域名")
  expect(f.plugins.confirm).not.toHaveBeenCalled()
  await select("取消", dialog())
  expect(f.plugins.cancel).toHaveBeenCalledExactlyOnceWith(capabilityDisclosure.confirmationId)
  await select("更新 度量助手", app.container, "button[aria-label]")
  await select("确认更新", dialog())
  expect(f.plugins.confirm).toHaveBeenCalledExactlyOnceWith("changed-bundle")
})

it("关闭时可以在本机停用和删除市场源", async () => {
  const f = marketplaceFixture(true, [marketEntry], [originalSource], false)
  await openMarketplace(app, f)
  await select("市场源", app.container)
  await select("启用 团队目录", dialog(), '[role="switch"]')
  expect(f.market.setEnabled).toHaveBeenCalledExactlyOnceWith("team-market", false)
  expect(dialog().textContent).toContain("已停用")
  await select("删除 团队目录", dialog(), "button[aria-label]")
  await select("删除市场源", dialog())
  expect(f.market.remove).toHaveBeenCalledExactlyOnceWith("team-market")
  expect(f.market.refresh).not.toHaveBeenCalled()
  expect(f.plugins.uninstall).not.toHaveBeenCalled()
})
