// 验证已有会话设置可按插件保存工具询问偏好。

// @vitest-environment jsdom
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import type {
  CapabilityPluginsBridge,
  InstalledCapabilityPlugin,
} from "../../../../capability-plugin-contract"
import { SessionSettings } from "./settings-app-pages"

it("会话设置展示已安装的插件并只保存用户选择的插件偏好", async () => {
  const plugin: InstalledCapabilityPlugin = {
    type: "capability",
    manifest: {
      apiVersion: 1,
      id: "fixture.labels",
      name: "标签插件",
      version: "1.0.0",
      entry: "index.mjs",
      pigclaudeVersion: "*",
      tools: [{ name: "label", description: "Read label", inputSchema: { type: "object" } }],
      permissions: [],
      networkDomains: [],
      settings: [],
      commands: [],
      toolResultTemplates: [],
    },
    revision: "revision-1",
    enabled: true,
    installedAt: "2026-11-14T01:00:00.000Z",
    sourceKind: "directory",
    sha256: null,
    compatible: true,
    approvedDomains: [],
    toolApproval: "always_ask",
  }
  const bridge = {
    list: vi.fn().mockResolvedValue([plugin]),
    setToolApproval: vi.fn().mockResolvedValue({ ...plugin, toolApproval: "follow_session" }),
    subscribe: () => () => undefined,
  } satisfies Pick<CapabilityPluginsBridge, "list" | "setToolApproval" | "subscribe">
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("pigclaude", { capabilityPlugins: bridge })
  try {
    await act(async () =>
      root.render(
        createElement(LocaleProvider, {
          locale: "zh-CN",
          children: createElement(SessionSettings, {}),
        }),
      ),
    )
    expect(container.textContent).toContain("下次启动会话时生效")
    const group = container.querySelector('[aria-label="标签插件的工具询问"]')
    const choices = [...(group?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
    const [alwaysAsk, follow] = choices
    expect(alwaysAsk?.getAttribute("aria-checked")).toBe("true")
    if (!follow) throw new Error("缺少跟随会话权限档的选项")
    await act(async () => follow.click())
    expect(bridge.setToolApproval).toHaveBeenCalledExactlyOnceWith(
      "fixture.labels",
      "follow_session",
    )
    expect(follow.getAttribute("aria-checked")).toBe("true")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
