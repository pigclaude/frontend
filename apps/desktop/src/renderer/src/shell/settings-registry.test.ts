// 验证设置扩展点渲染失败只替换当前页，侧栏仍能切到其他页。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { createExtensionRegistry, ExtensionRegistryScope } from "@pigclaude/client-runtime"
import { LocaleProvider } from "@pigclaude/ui-primitives"
import { registerSettingsPages, SettingsContributionView } from "./settings-registry"

it("设置页注册回调抛错时保留外壳，随后能打开其他页", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined)
  const host = document.createElement("div")
  const root = createRoot(host)
  const registry = createExtensionRegistry()
  const unregister = registerSettingsPages(
    registry,
    (page) => {
      if (page === "general") throw new Error("测试页出错")
      return createElement("h1", null, "可用的外观页")
    },
    () => undefined,
  )
  const render = (page: string) =>
    act(async () =>
      root.render(
        createElement(
          LocaleProvider,
          { locale: "zh-CN", children: null },
          createElement(
            ExtensionRegistryScope,
            { registry },
            createElement("aside", null, "设置侧栏"),
            createElement(SettingsContributionView, { page }),
          ),
        ),
      ),
    )
  try {
    await render("general")
    expect(host.textContent).toContain("设置侧栏")
    expect(host.textContent).toContain("这个设置页没有显示出来")
    expect(host.textContent).toContain("测试页出错")
    await render("appearance")
    expect(host.textContent).toContain("设置侧栏")
    expect(host.textContent).toContain("可用的外观页")
    expect(host.textContent).not.toContain("测试页出错")
  } finally {
    await act(async () => root.unmount())
    unregister()
    errorLog.mockRestore()
    vi.unstubAllGlobals()
  }
})
