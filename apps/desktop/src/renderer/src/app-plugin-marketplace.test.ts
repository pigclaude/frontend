// 通过真实应用设置入口核对市场源管理、安装披露和手动更新。
// @vitest-environment jsdom

import type {
  CapabilityPluginsBridge,
  DesktopPluginInstallDisclosure,
  InstalledCapabilityPlugin,
} from "../../capability-plugin-contract"
import type {
  PluginMarketplaceBridge,
  PluginMarketplaceEntryView,
  PluginMarketplaceSourceView,
} from "../../plugin-marketplace-contract"
import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { DesktopApp } from "./app"
import { buttonNamed, clickButton } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"

const app = desktopAppRoot()

const originalSource: PluginMarketplaceSourceView = {
  id: "team-market",
  kind: "directory",
  label: "/market/team",
  catalogName: "团队目录",
  enabled: true,
  refreshedAt: "2026-11-15T00:00:00.000Z",
  entryCount: 2,
  error: null,
  pin: null,
}

const installedPlugin: InstalledCapabilityPlugin = {
  type: "capability",
  manifest: {
    apiVersion: 1,
    id: "local-tool",
    name: "本地工具",
    version: "1.0.0",
    pigclaudeVersion: "*",
    entry: "index.mjs",
    tools: [],
    permissions: [],
    networkDomains: [],
    settings: [],
    commands: [],
    toolResultTemplates: [],
  },
  revision: "local-revision",
  installedAt: "2026-11-15T00:00:00.000Z",
  sourceKind: "directory",
  sha256: null,
  approvedDomains: [],
  toolApproval: "always_ask",
  enabled: true,
  compatible: true,
}

const marketEntry: PluginMarketplaceEntryView = {
  id: "guide",
  name: "工程手册",
  sourceId: "team-market",
  type: "claude-code",
  description: "工程项目的规则与指引",
  version: "2.0.0",
  author: "文档团队",
  permissions: [],
  domains: [],
  action: "install",
}

const capabilityEntry: PluginMarketplaceEntryView = {
  ...marketEntry,
  id: "metrics",
  name: "度量助手",
  type: "capability",
  permissions: ["network"],
  domains: ["catalog.example.org"],
}

const claudeDisclosure: DesktopPluginInstallDisclosure = {
  type: "claude-code",
  confirmationId: "prepared-guide",
  sourceKind: "directory",
  sha256: null,
  manifest: {
    id: "guide",
    name: "工程手册",
    version: "2.0.0",
    commands: ["guide:overview"],
    skills: ["guide:check"],
    agents: [],
    ignoredComponents: ["mcp"],
    skillExecution: [{ name: "guide:check", inline: false, hooks: true, allowedTools: false }],
  },
}

const capabilityDisclosure: DesktopPluginInstallDisclosure = {
  type: "capability",
  confirmationId: "prepared-metrics",
  sourceKind: "archive",
  sha256: "d".repeat(64),
  manifest: {
    ...installedPlugin.manifest,
    id: "metrics",
    name: "度量助手",
    permissions: ["network"],
    networkDomains: ["verified.example.org"],
  },
}

const unavailable = async () => {
  throw new Error("FIXTURE_UNEXPECTED_CALL")
}

function fixture(developerMode = true, entries = [marketEntry], initialSources = [originalSource]) {
  let sources = initialSources
  const market = {
    list: vi.fn<PluginMarketplaceBridge["list"]>(async () => ({
      developerMode,
      sources,
      entries,
    })),
    selectDirectory: vi.fn<PluginMarketplaceBridge["selectDirectory"]>(async () => "/market/local"),
    add: vi.fn<PluginMarketplaceBridge["add"]>(async () => undefined),
    refresh: vi.fn<PluginMarketplaceBridge["refresh"]>(async (id, pin) => {
      if (pin !== undefined)
        sources = sources.map((source) => (source.id === id ? { ...source, pin } : source))
    }),
    setEnabled: vi.fn<PluginMarketplaceBridge["setEnabled"]>(async (id, enabled) => {
      sources = sources.map((source) => (source.id === id ? { ...source, enabled } : source))
    }),
    remove: vi.fn<PluginMarketplaceBridge["remove"]>(async (id) => {
      sources = sources.filter((source) => source.id !== id)
    }),
    prepareInstall: vi.fn<PluginMarketplaceBridge["prepareInstall"]>(unavailable),
    prepareUpdate: vi.fn<PluginMarketplaceBridge["prepareUpdate"]>(unavailable),
    subscribe: () => () => undefined,
  } satisfies PluginMarketplaceBridge
  const plugins = {
    status: async () => ({ developerMode }),
    list: async () => [installedPlugin],
    listDeclarations: async () => [],
    readSettings: unavailable,
    setSetting: unavailable,
    runCommand: unavailable,
    pick: unavailable,
    prepare: unavailable,
    confirm: vi.fn<CapabilityPluginsBridge["confirm"]>(async () => installedPlugin),
    cancel: vi.fn<CapabilityPluginsBridge["cancel"]>(async () => undefined),
    setEnabled: unavailable,
    setToolApproval: unavailable,
    uninstall: vi.fn<CapabilityPluginsBridge["uninstall"]>(unavailable),
    subscribe: () => () => undefined,
  } satisfies CapabilityPluginsBridge
  return { market, plugins }
}

async function openMarket({ market, plugins }: ReturnType<typeof fixture>): Promise<void> {
  installFakeDesktopBridge()
  if (!window.pigclaude) throw new Error("桌面桥未初始化")
  window.pigclaude.pluginMarketplace = market
  window.pigclaude.capabilityPlugins = plugins
  window.history.replaceState({}, "", "/?screen=general")
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await select("插件", app.container)
  await select("插件市场", app.container, '[role="radio"]')
}

async function select(name: string, scope: ParentNode, selector?: string): Promise<void> {
  await clickButton(
    selector
      ? [...scope.querySelectorAll<HTMLElement>(selector)].find(
          (node) => (node.getAttribute("aria-label") ?? node.textContent?.trim()) === name,
        )
      : buttonNamed(name, scope),
    name,
  )
  await flush()
}

function dialog(): HTMLElement {
  const open = document.querySelector<HTMLElement>('[role="dialog"]:not([data-ending-style])')
  if (!open) throw new Error("没有打开对话框")
  return open
}

function fieldByLabel(label: string): HTMLInputElement {
  const field = [...dialog().querySelectorAll("label")].find((item) => item.textContent === label)
  const input = field?.control
  if (!(input instanceof HTMLInputElement)) throw new Error("没有输入框 " + label)
  return input
}

async function fillField(label: string, value: string): Promise<void> {
  const input = fieldByLabel(label)
  await act(async () => {
    const user = userEvent.setup()
    await user.clear(input)
    await user.paste(value)
  })
  expect(input.value).toBe(value)
}

it("停用市场源会隐藏目录条目，已安装列表保持可用", async () => {
  const f = fixture()
  await openMarket(f)
  expect(app.container.textContent).toContain("工程手册")
  await select("市场源", app.container)
  await select("启用 团队目录", dialog(), '[role="switch"]')
  expect(f.market.setEnabled).toHaveBeenCalledExactlyOnceWith("team-market", false)
  expect(dialog().textContent).toContain("已停用")
  await select("刷新 团队目录", dialog(), "button[aria-label]")
  expect(f.market.refresh).toHaveBeenCalledExactlyOnceWith("team-market")
  await select("关闭", dialog(), '[aria-label="关闭"]')
  expect(app.container.textContent).not.toContain("工程手册")
  await select("已安装", app.container, '[role="radio"]')
  expect(app.container.textContent).toContain("本地工具")
  expect(f.plugins.uninstall).not.toHaveBeenCalled()
})

it("市场添加表单要求固定提交或 SHA，开发目录使用原生选择", async () => {
  const f = fixture()
  await openMarket(f)
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

it("正式模式隐藏开发目录，刷新错误保留来源，删除先确认且保留已安装插件", async () => {
  const f = fixture(false)
  f.market.refresh.mockRejectedValueOnce(new Error("private refresh path /internal/fixture"))
  await openMarket(f)
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
  await openMarket(f)

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
  await openMarket(f)
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
  await openMarket(f)
  await select("安装 工程手册", app.container, "button[aria-label]")
  expect(app.container.textContent).toContain("正在读取插件…")
  await select("已安装", app.container, '[role="radio"]')
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
  await openMarket(f)
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
