// 验证一次插件登记同时更新命令面板与斜杠菜单，撤销时仅移除该插件的贡献。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { createExtensionRegistry, ExtensionRegistryScope } from "@pigclaude/client-runtime"
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { ToolBlock } from "@pigclaude/ui-chat"
import { expect, it, vi } from "vitest"
import type { CapabilityPluginDeclarations } from "../../../capability-plugin-contract"
import { registerCapabilityPluginContributions } from "./capability-plugin-contributions"
import { ToolRenderers } from "../components/tool-renderers"
import { slashCommands } from "./registry-slash-commands"

it("同一登记提供命令、斜杠和精确工具模板，停用后已打开的菜单也不能运行旧命令", async () => {
  const registry = createExtensionRegistry()
  const source: CapabilityPluginDeclarations = {
    pluginId: "fixture",
    revision: "1",
    commands: [{ id: "hello", title: "示例命令", slash: "/example" }],
    toolResults: [{ toolName: "mcp__plugin_fixture__hello", template: "结果：{{result}}" }],
  }
  const run = vi.fn(async () => undefined)
  const dispose = registerCapabilityPluginContributions(registry, source, run)
  const command = registry.get("command")[0]
  const slash = slashCommands(registry.get("command"), (key) => key)[0]
  const renderer = registry.get("toolRenderer")[0]

  expect(command?.title).toEqual({ text: "示例命令" })
  expect(slash?.label).toBe("/example")
  slash?.run?.()
  await command?.run()
  expect(run.mock.calls).toEqual([["hello"], ["hello"]])
  expect(renderer?.matches("mcp__plugin_fixture__hello")).toBe(true)
  expect(renderer?.matches("mcp__other_fixture__hello")).toBe(false)

  dispose()
  slash?.run?.()
  await command?.run()
  expect(run).toHaveBeenCalledTimes(2)
  expect(registry.get("command")).toEqual([])
  expect(registry.get("toolRenderer")).toEqual([])
})

it("对精确命中的工具渲染纯文本模板，注销后恢复普通结果", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const registry = createExtensionRegistry()
  const display = "本机报告：<b>合成摘要</b>"
  const tool = {
    id: "fixture-result",
    name: "mcp__plugin_fixture__identify",
    status: "completed" as const,
    input: undefined,
    output: JSON.stringify([
      { type: "text", text: JSON.stringify({ summary: "<b>合成摘要</b>" }) },
    ]),
  }
  const remove = registerCapabilityPluginContributions(
    registry,
    {
      pluginId: "fixture",
      revision: "1",
      commands: [],
      toolResults: [{ toolName: tool.name, template: "本机报告：{{summary}}" }],
    },
    async () => undefined,
  )
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        createElement(LocaleProvider, {
          locale: "zh-CN",
          children: createElement(ExtensionRegistryScope, {
            registry,
            children: createElement(ToolRenderers, {
              children: createElement(ToolBlock, { tool }),
            }),
          }),
        }),
      ),
    )
    const expand = container.querySelector<HTMLElement>(".tool-row-head")
    if (!expand) throw new Error("缺少工具结果行")
    await act(async () => expand.click())
    expect(container.textContent).toContain(display)
    expect(container.querySelector("b")).toBeNull()

    await act(async () => remove())
    expect(container.textContent).not.toContain("本机报告：")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
