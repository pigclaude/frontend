// 通过设置导航和真实安装组件验证准备、披露、取消及确认只传递选中的本机插件。
// @vitest-environment jsdom

import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import type {
  CapabilityPluginManifest,
  CapabilityPluginsBridge,
  ClaudeCodePluginManifest,
  DesktopPluginInstallDisclosure,
  InstalledDesktopPlugin,
} from "../../capability-plugin-contract"
import type { MembershipState, MembershipView } from "@pigclaude/contracts/membership"
import { DesktopApp } from "./app"
import { buttonNamed, clickButton } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"

const app = desktopAppRoot()
const archive = "/fixtures/word-count.zip"
const sha256 = "a".repeat(64)
const manifest: CapabilityPluginManifest = {
  apiVersion: 1,
  id: "word-count",
  name: "文档字数",
  version: "1.0.0",
  pigclaudeVersion: "*",
  entry: "index.mjs",
  permissions: ["workspace-read", "network", "secrets"],
  networkDomains: ["example.org"],
  tools: [
    { name: "count_words", description: "统计指定文档的字数", inputSchema: { type: "object" } },
  ],
  settings: [{ key: "apiToken", label: "索引密钥", type: "secret" }],
  commands: [],
  toolResultTemplates: [],
}

const claudeManifest: ClaudeCodePluginManifest = {
  id: "project-guide",
  name: "工程手册",
  version: "2.0.0",
  commands: ["project-guide:overview"],
  skills: ["project-guide:checklist"],
  agents: ["project-guide:reviewer"],
  ignoredComponents: ["hooks", "mcp", "lsp"],
  skillExecution: [
    { name: "project-guide:checklist", inline: true, hooks: true, allowedTools: true },
  ],
}

function fakePlugins(
  developerMode = false,
  selectType: () => DesktopPluginInstallDisclosure["type"] = () => "capability",
) {
  let prepared: DesktopPluginInstallDisclosure | null = null
  let sequence = 0
  let plugins: InstalledDesktopPlugin[] = []
  const events = new Set<() => void>()
  const changed = () => events.forEach((listener) => listener())
  return {
    status: async () => ({ developerMode }),
    list: async () => plugins,
    listDeclarations: async () => [],
    readSettings: async () => ({ values: {}, configuredSecrets: ["apiToken"] }),
    setSetting: vi.fn<CapabilityPluginsBridge["setSetting"]>(async () => ({
      values: {},
      configuredSecrets: [],
    })),
    runCommand: async () => ({ insertText: null }),
    pick: vi.fn<CapabilityPluginsBridge["pick"]>(async (kind) =>
      kind === "archive" ? archive : "/fixtures/word-count",
    ),
    prepare: vi.fn<CapabilityPluginsBridge["prepare"]>(async (source) => {
      const details = {
        confirmationId: `prepared-${++sequence}`,
        sourceKind: source.kind,
        sha256: source.kind === "archive" ? source.sha256 : null,
      }
      prepared =
        selectType() === "claude-code"
          ? { ...details, type: "claude-code", manifest: claudeManifest }
          : { ...details, type: "capability", manifest }
      return prepared
    }),
    confirm: vi.fn<CapabilityPluginsBridge["confirm"]>(async (id) => {
      if (!prepared || prepared.confirmationId !== id)
        throw new Error("PLUGIN_CONFIRMATION_INVALID")
      const details = {
        sourceKind: prepared.sourceKind,
        sha256: prepared.sha256,
        revision: "test-revision",
        installedAt: "2026-11-15T01:00:00.000Z",
        enabled: true,
        compatible: true,
      }
      const plugin: InstalledDesktopPlugin =
        prepared.type === "claude-code"
          ? { ...details, type: "claude-code", manifest: prepared.manifest }
          : {
              ...details,
              type: "capability",
              manifest: prepared.manifest,
              approvedDomains: prepared.manifest.networkDomains,
              toolApproval: "always_ask",
            }
      prepared = null
      plugins = [...plugins, plugin]
      changed()
      return plugin
    }),
    cancel: vi.fn<CapabilityPluginsBridge["cancel"]>(async (id) => {
      if (prepared?.confirmationId === id) prepared = null
    }),
    setEnabled: vi.fn<CapabilityPluginsBridge["setEnabled"]>(async (id, enabled) => {
      const plugin = plugins.find((item) => item.manifest.id === id)
      if (!plugin) throw new Error("PLUGIN_NOT_INSTALLED")
      const updated = { ...plugin, enabled }
      plugins = plugins.map((item) => (item.manifest.id === id ? updated : item))
      changed()
      return updated
    }),
    setToolApproval: vi.fn<CapabilityPluginsBridge["setToolApproval"]>(async (id, toolApproval) => {
      const plugin = plugins.find((item) => item.manifest.id === id)
      if (!plugin || plugin.type !== "capability") throw new Error("PLUGIN_NOT_INSTALLED")
      const updated = { ...plugin, toolApproval }
      plugins = plugins.map((item) => (item.manifest.id === id ? updated : item))
      changed()
      return updated
    }),
    uninstall: vi.fn<CapabilityPluginsBridge["uninstall"]>(async (id) => {
      plugins = plugins.filter((item) => item.manifest.id !== id)
      changed()
    }),
    subscribe: (listener) => {
      events.add(listener)
      return () => void events.delete(listener)
    },
  } satisfies CapabilityPluginsBridge
}

async function openSettings(bridge: CapabilityPluginsBridge) {
  installFakeDesktopBridge()
  const membership = window.pigclaude?.membership
  if (!window.pigclaude || !membership) throw new Error("桌面桥未初始化")
  let listener: ((view: MembershipView) => void) | undefined
  membership.subscribe = (next) => {
    listener = next
    return () => {
      listener = undefined
    }
  }
  window.pigclaude.capabilityPlugins = bridge
  window.history.replaceState({}, "", "/?screen=chat-new")
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await click("插件", app.container)
  expect(app.container.querySelector("[data-screen]")?.getAttribute("data-screen")).toBe("plugins")
  const start = await membership.inspect()
  if (!start) throw new Error("会员夹具缺少初始状态")
  let revision = start.revision
  return async (state: MembershipState) => {
    await act(async () => listener?.({ ...start, state, revision: ++revision }))
    await flush()
  }
}

async function click(name: string, scope: ParentNode = document): Promise<void> {
  await clickButton(buttonNamed(name, scope), name)
  await flush()
}

function dialog(): HTMLElement {
  const visible = document.querySelector<HTMLElement>('[role="dialog"]:not([data-ending-style])')
  if (!visible) throw new Error("没有打开对话框")
  return visible
}

async function prepareArchive(): Promise<HTMLElement> {
  await installFrom("从归档安装")
  const source = dialog()
  await enterDigest(sha256, source)
  await click("查看插件披露", source)
  return dialog()
}

function installMenuItem(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === name,
  )
}

async function openInstallMenu(): Promise<void> {
  const trigger = buttonNamed("添加插件", app.container)
  if (!trigger) throw new Error("没有添加插件入口")
  await act(async () => {
    trigger.focus()
    await userEvent.setup().keyboard("{ArrowDown}")
  })
  await flush()
  expect(trigger.getAttribute("aria-expanded")).toBe("true")
}

async function installFrom(name: "从归档安装" | "从目录安装"): Promise<void> {
  await openInstallMenu()
  await clickButton(installMenuItem(name), name)
  await flush()
}

async function enterDigest(digest: string, source: HTMLElement): Promise<void> {
  const input = source.querySelector<HTMLInputElement>("input")
  if (!input) throw new Error("没有归档摘要输入框")
  await act(async () => {
    input.focus()
    await userEvent.setup().paste(digest)
  })
  expect(input.value).toBe(digest)
}

it("在安装归档之前显示声明，取消不安装，确认只提交当前披露的标识", async () => {
  const bridge = fakePlugins()
  await openSettings(bridge)
  await openInstallMenu()
  expect(installMenuItem("从目录安装")).toBeUndefined()
  await clickButton(installMenuItem("从归档安装"), "从归档安装")
  await flush()
  await enterDigest(sha256, dialog())
  await click("查看插件披露", dialog())
  const disclosure = dialog()
  expect(bridge.pick).toHaveBeenCalledWith("archive")
  expect(bridge.prepare).toHaveBeenCalledWith({ kind: "archive", path: archive, sha256 })
  expect(disclosure.textContent).toContain("能力插件")
  expect(disclosure.textContent).toContain("读取工作区文件")
  expect(disclosure.textContent).toContain("example.org")
  expect(disclosure.textContent).toContain("count_words")
  expect(disclosure.textContent).toContain("被忽略的组件")
  expect(disclosure.textContent).toContain("Skill 执行项")
  expect(bridge.confirm).not.toHaveBeenCalled()
  await click("取消", disclosure)
  expect(bridge.cancel).toHaveBeenCalledWith("prepared-1")
  expect(bridge.confirm).not.toHaveBeenCalled()
  await click("确认安装", await prepareArchive())
  expect(bridge.confirm).toHaveBeenCalledExactlyOnceWith("prepared-2")
  expect(app.container.querySelector('[aria-label="文档字数 的详情"]')).not.toBeNull()
})

it("开发模式从本地目录安装，切换启用状态并可选择保留数据后卸载", async () => {
  const bridge = fakePlugins(true)
  await openSettings(bridge)
  await installFrom("从目录安装")
  expect(bridge.prepare).toHaveBeenCalledExactlyOnceWith({
    kind: "directory",
    path: "/fixtures/word-count",
  })
  await click("确认安装", dialog())

  const toggle = () =>
    app.container.querySelector<HTMLElement>('[role="switch"][aria-label="启用 文档字数"]')
  expect(toggle()?.getAttribute("aria-checked")).toBe("true")
  await clickButton(toggle() ?? undefined, "停用插件")
  await flush()
  expect(toggle()?.getAttribute("aria-checked")).toBe("false")
  await clickButton(toggle() ?? undefined, "启用插件")
  await flush()
  expect(toggle()?.getAttribute("aria-checked")).toBe("true")
  expect(bridge.setEnabled.mock.calls).toEqual([
    ["word-count", false],
    ["word-count", true],
  ])

  const detail = app.container.querySelector<HTMLElement>('[aria-label="文档字数 的详情"]')
  await clickButton(detail ?? undefined, "文档字数 的详情")
  expect(dialog().textContent).toContain("count_words")
  await click("卸载", dialog())
  const keepData = () => dialog().querySelector<HTMLElement>('[role="checkbox"]')
  expect(keepData()?.getAttribute("aria-checked")).toBe("false")
  await clickButton(keepData() ?? undefined, "保留插件数据")
  expect(keepData()?.getAttribute("aria-checked")).toBe("true")
  await click("确认卸载", dialog())
  expect(bridge.uninstall).toHaveBeenCalledExactlyOnceWith("word-count", true)
  expect(app.container.textContent).toContain("还没有安装插件")
})

it("从插件页打开宿主渲染的表单并清除密钥，不返显保存的明文", async () => {
  const bridge = fakePlugins(true)
  await openSettings(bridge)
  await installFrom("从目录安装")
  await click("确认安装", dialog())
  const open = app.container.querySelector<HTMLElement>('[aria-label="打开 文档字数 的设置"]')
  await clickButton(open ?? undefined, "打开 文档字数 的设置")
  await flush()
  const form = dialog()
  expect(form.textContent).toContain("文档字数 的设置")
  const field = form.querySelector<HTMLInputElement>('input[type="password"]')
  expect(field?.placeholder).toBe("密钥已保存")
  expect(field?.value).toBe("")
  await click("清除", form)
  expect(bridge.setSetting).toHaveBeenCalledExactlyOnceWith(
    { pluginId: "word-count", revision: "test-revision" },
    "apiToken",
    null,
  )
  expect(field?.placeholder).toBe("尚未设置密钥")
})

it("校验归档摘要格式，安装确认过期后回到列表并给出可重试提示", async () => {
  const bridge = fakePlugins()
  await openSettings(bridge)
  await installFrom("从归档安装")
  let source = dialog()
  await enterDigest("bad-sha256", source)
  await click("查看插件披露", source)
  expect(source.querySelector('[role="alert"]')?.textContent).toBe(
    "SHA-256 校验值须为 64 位十六进制字符。",
  )
  expect(bridge.prepare).not.toHaveBeenCalled()
  await click("取消", source)

  source = await prepareArchive()
  bridge.confirm.mockRejectedValueOnce(
    new Error(
      "Error invoking remote method 'private-bridge-marker': Error: PLUGIN_CONFIRMATION_INVALID",
    ),
  )
  await click("确认安装", source)
  expect(app.container.querySelector('[role="alert"]')?.textContent).toBe(
    "安装确认已失效。请重新选择插件。",
  )
  expect(document.body.textContent).not.toContain("private-bridge-marker")
  expect(bridge.cancel).toHaveBeenCalledWith("prepared-1")
})

it("进入会员网络宽限时放弃尚未确认的安装，会员恢复后重新准备", async () => {
  const bridge = fakePlugins(true)
  const changeMembership = await openSettings(bridge)
  await installFrom("从目录安装")
  expect(dialog().textContent).toContain("安装披露")

  await changeMembership("network_grace")
  expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith("prepared-1")
  expect(buttonNamed("添加插件", app.container)).toBeUndefined()
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(bridge.confirm).not.toHaveBeenCalled()

  await changeMembership("active")
  await installFrom("从目录安装")
  await click("确认安装", dialog())
  expect(bridge.confirm).toHaveBeenCalledExactlyOnceWith("prepared-2")
})

it("Claude Code 插件在确认前披露忽略项和 Skill 执行项，确认后和能力插件分组显示", async () => {
  let type: DesktopPluginInstallDisclosure["type"] = "capability"
  const bridge = fakePlugins(true, () => type)
  await openSettings(bridge)
  await installFrom("从目录安装")
  await click("确认安装", dialog())
  bridge.confirm.mockClear()

  type = "claude-code"
  const disclosure = await prepareArchive()
  expect(disclosure.textContent).toContain("Claude Code 插件")
  expect(disclosure.textContent).toContain("project-guide:overview")
  expect(disclosure.textContent).toContain("project-guide:reviewer")
  const facts = (panel: ParentNode, title: string) =>
    [...panel.querySelectorAll("dt")].find((item) => item.textContent === title)?.nextElementSibling
      ?.textContent
  expect(facts(disclosure, "被忽略的组件")).toBe("插件 hooks, MCP 服务器, LSP 配置")
  expect(facts(disclosure, "Skill 执行项")).toContain("project-guide:checklist")
  expect(facts(disclosure, "Skill 执行项")).toContain("! 内联命令 · 文件头 hooks · allowed-tools")
  expect(bridge.confirm).not.toHaveBeenCalled()
  await click("确认安装", disclosure)
  expect(bridge.confirm).toHaveBeenCalledExactlyOnceWith("prepared-2")

  const groups = [...app.container.querySelectorAll("h2")].map((heading) => heading.textContent)
  expect(groups).toContain("Claude Code 插件")
  expect(groups).toContain("能力")
  expect(app.container.querySelector('[aria-label="打开 工程手册 的设置"]')).toBeNull()
  expect(app.container.querySelector('[aria-label="打开 文档字数 的设置"]')).not.toBeNull()
  const detail = app.container.querySelector<HTMLElement>('[aria-label="工程手册 的详情"]')
  await clickButton(detail ?? undefined, "工程手册 的详情")
  expect(dialog().textContent).toContain("Claude Code 插件")
  expect(facts(dialog(), "被忽略的组件")).toContain("MCP 服务器")
  expect(facts(dialog(), "Skill 执行项")).toContain("文件头 hooks")
  expect(facts(dialog(), "API 版本")).toBeUndefined()
  const close = dialog().querySelector<HTMLElement>('button[aria-label="关闭"]')
  await clickButton(close ?? undefined, "关闭插件详情")
  const toggle = app.container.querySelector<HTMLElement>(
    '[role="switch"][aria-label="启用 工程手册"]',
  )
  await clickButton(toggle ?? undefined, "停用 Claude Code 插件")
  await flush()
  expect(bridge.setEnabled).toHaveBeenCalledExactlyOnceWith("project-guide", false)
  expect(toggle?.getAttribute("aria-checked")).toBe("false")

  await clickButton(detail ?? undefined, "重新打开 Claude Code 插件详情")
  await click("卸载", dialog())
  expect(dialog().textContent).toContain("卸载会删除 PigClaude 保存的插件副本。")
  expect(dialog().querySelector('[role="checkbox"]')).toBeNull()
  await click("确认卸载", dialog())
  expect(bridge.uninstall).toHaveBeenCalledExactlyOnceWith("project-guide", false)
  expect(app.container.querySelector('[aria-label="工程手册 的详情"]')).toBeNull()
  expect(app.container.querySelector('[aria-label="文档字数 的详情"]')).not.toBeNull()
})
