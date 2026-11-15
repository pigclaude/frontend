// 通过设置导航和真实安装组件验证准备、披露、取消及确认只传递选中的本机插件。
// @vitest-environment jsdom

import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import type {
  CapabilityPluginInstallDisclosure,
  CapabilityPluginManifest,
  CapabilityPluginsBridge,
  InstalledCapabilityPlugin,
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
  permissions: ["workspace-read", "network"],
  networkDomains: ["example.org"],
  tools: [
    { name: "count_words", description: "统计指定文档的字数", inputSchema: { type: "object" } },
  ],
  settings: [],
  commands: [],
  toolResultTemplates: [],
}

function fakePlugins(developerMode = false) {
  let prepared: CapabilityPluginInstallDisclosure | null = null
  let sequence = 0
  let plugins: InstalledCapabilityPlugin[] = []
  const events = new Set<() => void>()
  const changed = () => events.forEach((listener) => listener())
  return {
    status: async () => ({ developerMode }),
    list: async () => plugins,
    pick: vi.fn<CapabilityPluginsBridge["pick"]>(async (kind) =>
      kind === "archive" ? archive : "/fixtures/word-count",
    ),
    prepare: vi.fn<CapabilityPluginsBridge["prepare"]>(async (source) => {
      prepared = {
        type: "capability",
        confirmationId: `prepared-${++sequence}`,
        manifest,
        sourceKind: source.kind,
        sha256: source.kind === "archive" ? source.sha256 : null,
      }
      return prepared
    }),
    confirm: vi.fn<CapabilityPluginsBridge["confirm"]>(async (id) => {
      if (!prepared || prepared.confirmationId !== id)
        throw new Error("PLUGIN_CONFIRMATION_INVALID")
      const plugin: InstalledCapabilityPlugin = {
        type: "capability",
        manifest: prepared.manifest,
        sourceKind: prepared.sourceKind,
        sha256: prepared.sha256,
        revision: "test-revision",
        installedAt: "2026-11-15T01:00:00.000Z",
        approvedDomains: manifest.networkDomains,
        enabled: true,
        compatible: true,
      }
      prepared = null
      plugins = [plugin]
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
      plugins = [updated]
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
  window.history.replaceState({}, "", "/?screen=general")
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
  await click("从归档安装", app.container)
  const source = dialog()
  await enterDigest(sha256, source)
  await click("查看插件披露", source)
  return dialog()
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
  expect(buttonNamed("从目录安装", app.container)).toBeUndefined()
  const disclosure = await prepareArchive()
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
  await click("从目录安装", app.container)
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

it("校验归档摘要格式，安装确认过期后回到列表并给出可重试提示", async () => {
  const bridge = fakePlugins()
  await openSettings(bridge)
  await click("从归档安装", app.container)
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
  await click("从目录安装", app.container)
  expect(dialog().textContent).toContain("安装披露")

  await changeMembership("network_grace")
  expect(bridge.cancel).toHaveBeenCalledExactlyOnceWith("prepared-1")
  expect(buttonNamed("从目录安装", app.container)).toBeUndefined()
  expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  expect(bridge.confirm).not.toHaveBeenCalled()

  await changeMembership("active")
  await click("从目录安装", app.container)
  await click("确认安装", dialog())
  expect(bridge.confirm).toHaveBeenCalledExactlyOnceWith("prepared-2")
})
