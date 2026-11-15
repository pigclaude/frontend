// 在真实桌面应用中装配本机市场和插件安装夹具，并通过界面控件交互。

import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { expect, vi } from "vitest"
import type {
  CapabilityPluginsBridge,
  DesktopPluginInstallDisclosure,
  InstalledCapabilityPlugin,
} from "../../../capability-plugin-contract"
import type {
  PluginMarketplaceBridge,
  PluginMarketplaceEntryView,
  PluginMarketplaceSourceView,
} from "../../../plugin-marketplace-contract"
import { DesktopApp } from "../app"
import { buttonNamed, clickButton } from "./chat-screen-harness"
import { type DesktopAppRoot, flush, installFakeDesktopBridge } from "./desktop-app-harness"

/** 缓存中正常启用的合成来源。 */
export const originalSource: PluginMarketplaceSourceView = {
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

/** 本机安装记录，供插件页与市场组合夹具使用。 */
export const installedPlugin: InstalledCapabilityPlugin = {
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

/** Claude Code 的合成市场条目。 */
export const marketEntry: PluginMarketplaceEntryView = {
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
  reviewStatus: "unreviewed",
}

/** 能力插件的合成市场条目。 */
export const capabilityEntry: PluginMarketplaceEntryView = {
  ...marketEntry,
  id: "metrics",
  name: "度量助手",
  type: "capability",
  permissions: ["network"],
  domains: ["catalog.example.org"],
}

/** 仅携带声明数据的 Claude Code 安装披露。 */
export const claudeDisclosure: DesktopPluginInstallDisclosure = {
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

/** 仅携带声明数据的能力插件安装披露。 */
export const capabilityDisclosure: DesktopPluginInstallDisclosure = {
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

/** 在本机模拟市场缓存、用户授权和安装确认。 */
export function marketplaceFixture(
  developerMode = true,
  entries = [marketEntry],
  initialSources = [originalSource],
  initialThirdPartyEnabled = true,
) {
  let sources = initialSources
  let thirdPartyEnabled = initialThirdPartyEnabled
  const market = {
    list: vi.fn<PluginMarketplaceBridge["list"]>(async () => ({
      developerMode,
      thirdPartyEnabled,
      sources,
      entries,
    })),
    setThirdPartyEnabled: vi.fn<PluginMarketplaceBridge["setThirdPartyEnabled"]>(
      async (enabled) => {
        thirdPartyEnabled = enabled
      },
    ),
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
    setEnabled: vi.fn<CapabilityPluginsBridge["setEnabled"]>(unavailable),
    setToolApproval: unavailable,
    uninstall: vi.fn<CapabilityPluginsBridge["uninstall"]>(unavailable),
    subscribe: () => () => undefined,
  } satisfies CapabilityPluginsBridge
  return { market, plugins }
}

/** 从桌面设置的真实入口打开插件市场。 */
export async function openMarketplace(
  app: DesktopAppRoot,
  { market, plugins }: ReturnType<typeof marketplaceFixture>,
): Promise<void> {
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

/** 按可访问名称触发现有页面控件，并等到界面更新。 */
export async function select(name: string, scope: ParentNode, selector?: string): Promise<void> {
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

/** 返回当前可操作的模态对话框。 */
export function dialog(): HTMLElement {
  const open = document.querySelector<HTMLElement>('[role="dialog"]:not([data-ending-style])')
  if (!open) throw new Error("没有打开对话框")
  return open
}

/** 在当前模态中用标签找到输入框。 */
export function fieldByLabel(label: string): HTMLInputElement {
  const field = [...dialog().querySelectorAll("label")].find((item) => item.textContent === label)
  const input = field?.control
  if (!(input instanceof HTMLInputElement)) throw new Error("没有输入框 " + label)
  return input
}

/** 用真实用户输入事件替换当前模态里的字段。 */
export async function fillField(label: string, value: string): Promise<void> {
  const input = fieldByLabel(label)
  await act(async () => {
    const user = userEvent.setup()
    await user.clear(input)
    await user.paste(value)
  })
  expect(input.value).toBe(value)
}
