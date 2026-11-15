// 验证可信界面显示声明的设置，密钥输入保存后擦除并只显示已配置状态。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import type { InstalledCapabilityPlugin } from "../../../../capability-plugin-contract"
import { AppProviders } from "../../app-providers"
import { CapabilityPluginSettingsForm } from "./capability-plugin-settings-form"

const plugin: InstalledCapabilityPlugin = {
  type: "capability",
  enabled: true,
  compatible: true,
  revision: "fixture-revision",
  sourceKind: "directory",
  sha256: null,
  installedAt: "2026-11-15T00:00:00.000Z",
  approvedDomains: [],
  manifest: {
    apiVersion: 1,
    id: "fixture-settings",
    name: "合成插件",
    version: "1.0.0",
    pigclaudeVersion: "*",
    entry: "index.mjs",
    tools: [],
    permissions: ["secrets"],
    networkDomains: [],
    commands: [],
    toolResultTemplates: [],
    settings: [
      { key: "credential", label: "访问密钥", type: "secret" },
      { key: "interval", label: "间隔", type: "number", defaultValue: 1.5 },
    ],
  },
}

it("密钥从不回填，保存后擦除输入，停用后移除设置区域", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const readSettings = vi
    .fn()
    .mockResolvedValue({ values: { interval: 1.5 }, configuredSecrets: [] })
  const setSetting = vi.fn().mockResolvedValue({
    values: { interval: 1.5 },
    configuredSecrets: ["credential"],
  })
  vi.stubGlobal("pigclaude", { capabilityPlugins: { readSettings, setSetting } })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const show = (enabled: boolean) =>
    root.render(
      createElement(
        AppProviders,
        null,
        createElement(CapabilityPluginSettingsForm, { plugin: { ...plugin, enabled } }),
      ),
    )
  try {
    await act(async () => show(true))
    const password = container.querySelector<HTMLInputElement>('input[type="password"]')
    const form = container.querySelector("form")
    if (!password || !form) throw new Error("缺少插件设置表单")
    expect(password.value).toBe("")
    expect(password.placeholder).toBe("尚未设置密钥")
    expect(container.querySelector<HTMLInputElement>('input[name="interval"]')?.value).toBe("1.5")
    password.value = "synthetic-secret"
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    )
    expect(setSetting).toHaveBeenCalledExactlyOnceWith(
      { pluginId: "fixture-settings", revision: "fixture-revision" },
      "credential",
      "synthetic-secret",
    )
    const saved = container.querySelector<HTMLInputElement>('input[type="password"]')
    expect(saved?.value).toBe("")
    expect(saved?.placeholder).toBe("密钥已保存")
    expect(container.textContent).not.toContain("synthetic-secret")

    await act(async () => show(false))
    expect(container.querySelector("form")).toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
