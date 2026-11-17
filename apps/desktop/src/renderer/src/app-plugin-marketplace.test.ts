// 通过真实应用设置入口核对市场源管理、安装披露和手动更新。
// @vitest-environment jsdom

import type { DesktopPluginInstallDisclosure } from "../../capability-plugin-contract"
import { act } from "react"
import { expect, it } from "vitest"
import { buttonNamed } from "./test-support/chat-screen-harness"
import { desktopAppRoot } from "./test-support/desktop-app-harness"
import {
  capabilityDisclosure,
  capabilityEntry,
  claudeDisclosure,
  dialog,
  fieldByLabel,
  fillField,
  marketEntry,
  marketplaceFixture as fixture,
  openMarketplace,
  originalSource,
  select,
} from "./test-support/plugin-marketplace-harness"

const app = desktopAppRoot()

it("停用市场源会隐藏目录条目，已安装列表保持可用", async () => {
  const f = fixture()
  await openMarketplace(app, f)
  expect(app.container.textContent).toContain("工程手册")
  await select("市场源", app.container)
  await select("启用 团队目录", dialog(), '[role="switch"]')
  expect(f.market.setEnabled).toHaveBeenCalledExactlyOnceWith("team-market", false)
  expect(dialog().textContent).toContain("已停用")
  await select("刷新 团队目录", dialog(), "button[aria-label]")
  expect(f.market.refresh).toHaveBeenCalledExactlyOnceWith("team-market")
  await select("关闭", dialog(), '[aria-label="关闭"]')
  expect(app.container.textContent).not.toContain("工程手册")
  await select("插件管理", app.container)
  expect(app.container.textContent).toContain("本地工具")
  expect(f.plugins.uninstall).not.toHaveBeenCalled()
})

it("市场添加表单要求固定提交或 SHA，开发目录使用原生选择", async () => {
  const f = fixture()
  await openMarketplace(app, f)
  await select("市场源", app.container)
  await select("添加市场源", dialog())
  await fillField("GitHub 仓库", "sample/team-market")
  expect(buttonNamed("添加市场源", dialog())?.disabled).toBe(true)
  await fillField("固定提交", "a".repeat(40))
  await select("添加市场源", dialog())
  expect(f.market.add).toHaveBeenNthCalledWith(1, {
    kind: "github",
    repo: "sample/team-market",
    commit: "a".repeat(40),
  })

  await select("添加市场源", dialog())
  await select("HTTPS 归档", dialog(), '[role="radio"]')
  await fillField("HTTPS 地址", "https://example.org/team.tgz")
  expect(buttonNamed("添加市场源", dialog())?.disabled).toBe(true)
  await fillField("SHA-256 校验值", "b".repeat(64))
  await select("添加市场源", dialog())
  expect(f.market.add).toHaveBeenNthCalledWith(2, {
    kind: "https",
    url: "https://example.org/team.tgz",
    sha256: "b".repeat(64),
  })

  await select("添加市场源", dialog())
  await select("本地目录", dialog(), '[role="radio"]')
  expect(buttonNamed("添加市场源", dialog())?.disabled).toBe(true)
  await select("选择目录", dialog())
  await select("添加市场源", dialog())
  expect(f.market.selectDirectory).toHaveBeenCalledOnce()
  expect(f.market.add).toHaveBeenNthCalledWith(3, { kind: "directory", path: "/market/local" })
})

it("常用市场预填固定提交，只有用户提交才读取并添加来源", async () => {
  const f = fixture(false)
  await openMarketplace(app, f)
  await select("添加", app.container)
  const sources = [
    ["Claude Code 插件目录", "anthropics/claude-plugins-official"],
    ["Matt Pocock Skills", "mattpocock/skills"],
  ] as const
  for (const [index, [label, repo]] of sources.entries()) {
    await select(label, dialog())
    expect(fieldByLabel("GitHub 仓库").value).toBe(repo)
    const commit = fieldByLabel("固定提交").value
    expect(commit).toMatch(/^[a-f0-9]{40}$/)
    expect(f.market.add).toHaveBeenCalledTimes(index)
    await select("添加市场源", dialog())
    expect(f.market.add).toHaveBeenLastCalledWith({ kind: "github", repo, commit })
    if (index === 0) await select("添加市场源", dialog())
  }
})

it("正式模式隐藏开发目录，刷新错误保留来源，删除先确认且保留已安装插件", async () => {
  const f = fixture(false)
  f.market.refresh.mockRejectedValueOnce(new Error("private refresh path /internal/fixture"))
  await openMarketplace(app, f)
  await select("市场源", app.container)
  await select("添加市场源", dialog())
  expect(dialog().querySelector('[role="radio"][value="directory"]')).toBeNull()
  expect(dialog().textContent).not.toContain("本地目录")
  await select("取消", dialog())
  await select("刷新 团队目录", dialog(), "button[aria-label]")
  expect(f.market.refresh).toHaveBeenCalledExactlyOnceWith("team-market")
  expect(dialog().textContent).toContain("市场操作失败，请重试。")
  expect(dialog().textContent).not.toContain("/internal/fixture")
  expect(dialog().textContent).toContain("缓存 2 个插件")
  await select("删除 团队目录", dialog(), "button[aria-label]")
  expect(f.market.remove).not.toHaveBeenCalled()
  await select("删除市场源", dialog())
  expect(f.market.remove).toHaveBeenCalledExactlyOnceWith("team-market")
  expect(dialog().textContent).toContain("还没有添加市场源")
  expect(f.plugins.uninstall).not.toHaveBeenCalled()
})

it("两类市场插件用原安装桥确认；目录权限与实际包披露区分", async () => {
  const f = fixture(true, [marketEntry, capabilityEntry])
  f.market.prepareInstall
    .mockResolvedValueOnce(claudeDisclosure)
    .mockResolvedValueOnce(capabilityDisclosure)
  await openMarketplace(app, f)

  await select("安装 工程手册", app.container, "button[aria-label]")
  expect(f.market.prepareInstall).toHaveBeenNthCalledWith(1, "team-market", "guide")
  expect(dialog().textContent).toContain("MCP 服务器")
  expect(f.plugins.confirm).not.toHaveBeenCalled()
  await select("取消", dialog())
  expect(f.plugins.cancel).toHaveBeenCalledExactlyOnceWith("prepared-guide")

  await select("查看 度量助手 的市场详情", app.container, "button[aria-label]")
  expect(dialog().textContent).toContain("catalog.example.org")
  await select("安装 度量助手", dialog(), "button[aria-label]")
  expect(f.market.prepareInstall).toHaveBeenNthCalledWith(2, "team-market", "metrics")
  expect(dialog().textContent).toContain("verified.example.org")
  expect(dialog().textContent).not.toContain("catalog.example.org")
  expect(dialog().textContent).toContain("团队目录")
  await select("确认安装", dialog())
  expect(f.plugins.confirm).toHaveBeenCalledExactlyOnceWith("prepared-metrics")
  expect(app.container.textContent).toContain("插件已安装。")
})

it("依据主进程动作手动更新，扩权时显示实际差异及独立确认", async () => {
  const f = fixture(true, [
    { ...capabilityEntry, action: "update" },
    { ...marketEntry, action: "update" },
    {
      ...capabilityEntry,
      id: "installed",
      name: "已有工具",
      action: "installed",
      version: "8.0.0",
    },
  ])
  f.market.prepareUpdate
    .mockResolvedValueOnce({
      kind: "review",
      disclosure: { ...capabilityDisclosure, confirmationId: "update-token" },
      additionalPermissions: ["workspace-read"],
      additionalDomains: ["verified.example.org"],
    })
    .mockResolvedValueOnce({
      kind: "review",
      disclosure: { ...claudeDisclosure, confirmationId: "claude-update-token" },
      additionalPermissions: ["skill-hooks:guide:check"],
      additionalDomains: [],
    })
    .mockResolvedValueOnce({ kind: "unchanged" })
    .mockResolvedValueOnce({ kind: "updated" })
  await openMarketplace(app, f)
  expect(f.market.prepareUpdate).not.toHaveBeenCalled()
  expect(app.container.querySelector('[aria-label="更新 已有工具"]')).toBeNull()

  await select("更新 度量助手", app.container, "button[aria-label]")
  expect(f.market.prepareUpdate).toHaveBeenNthCalledWith(1, "team-market", "metrics")
  expect(dialog().textContent).toContain("更新披露")
  const changes = dialog().querySelector(".marketplace-update-facts")
  expect(changes?.textContent).toContain("新增权限")
  expect(changes?.textContent).toContain("读取工作区文件")
  expect(changes?.textContent).toContain("新增域名verified.example.org")
  expect(f.plugins.confirm).not.toHaveBeenCalled()
  await select("确认更新", dialog())
  expect(f.plugins.confirm).toHaveBeenCalledExactlyOnceWith("update-token")

  await select("更新 工程手册", app.container, "button[aria-label]")
  expect(f.market.prepareUpdate).toHaveBeenNthCalledWith(2, "team-market", "guide")
  const claudeChanges = dialog().querySelector(".marketplace-update-facts")
  expect(claudeChanges?.textContent).toContain("文件头 hooks · guide:check")
  expect(claudeChanges?.textContent).not.toContain("新增域名")
  await select("取消", dialog())
  expect(f.plugins.cancel).toHaveBeenCalledExactlyOnceWith("claude-update-token")

  await select("更新 度量助手", app.container, "button[aria-label]")
  expect(app.container.textContent).toContain("当前安装已是所选版本。")
  await select("更新 度量助手", app.container, "button[aria-label]")
  expect(app.container.textContent).toContain("插件已更新。")
  expect(f.plugins.confirm).toHaveBeenCalledTimes(1)
})

it("离开市场后收到的准备结果会放弃原令牌", async () => {
  const f = fixture()
  let finish: (value: DesktopPluginInstallDisclosure) => void = () => {
    throw new Error("尚未发起准备请求")
  }
  f.market.prepareInstall.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await openMarketplace(app, f)
  await select("安装 工程手册", app.container, "button[aria-label]")
  expect(app.container.textContent).toContain("正在读取插件…")
  await select("插件管理", app.container)
  await act(async () => finish(claudeDisclosure))
  expect(f.plugins.cancel).toHaveBeenCalledExactlyOnceWith("prepared-guide")
  expect(f.plugins.confirm).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(app.container.textContent).toContain("本地工具")
})

it.each([
  { kind: "github", label: "固定提交", length: 40 },
  { kind: "https", label: "SHA-256 校验值", length: 64 },
] as const)("停用的 $kind 来源可原地更换 pin，仍隐藏目录", async ({ kind, label, length }) => {
  const previous = "a".repeat(length)
  const updated = "b".repeat(length)
  const f = fixture(
    true,
    [marketEntry],
    [{ ...originalSource, kind, pin: previous, enabled: false }],
  )
  await openMarketplace(app, f)
  expect(app.container.textContent).not.toContain("工程手册")
  await select("市场源", app.container)
  await select("更换 团队目录 的版本", dialog(), "button[aria-label]")
  expect(fieldByLabel(label).value).toBe(previous)
  expect(buttonNamed("保存并刷新", dialog())?.disabled).toBe(true)
  await fillField(label, "not-a-pin")
  expect(buttonNamed("保存并刷新", dialog())?.disabled).toBe(true)
  await fillField(label, updated)
  expect(buttonNamed("保存并刷新", dialog())?.disabled).toBe(false)
  await select("保存并刷新", dialog())
  expect(f.market.refresh).toHaveBeenCalledExactlyOnceWith("team-market", updated)
  expect(dialog().textContent).toContain("已停用")
  await select("更换 团队目录 的版本", dialog(), "button[aria-label]")
  expect(fieldByLabel(label).value).toBe(updated)
  await select("取消", dialog())
  await select("关闭", dialog(), '[aria-label="关闭"]')
  expect(app.container.textContent).not.toContain("工程手册")
})
