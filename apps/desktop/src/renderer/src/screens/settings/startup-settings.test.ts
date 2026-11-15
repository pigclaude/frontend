// 验证通用页的开机自启开关和 macOS Dock 设置使用主进程返回的真实状态。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { StartupPreferencesBridge } from "../../../../startup-preferences-contract"
import { AppProviders } from "../../app-providers"
import { GeneralSettings } from "./settings-app-pages"

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

it.each(["win32", "linux"] as const)("在 %s 通用页可设置开机自启", async (platform) => {
  const set = vi.fn<StartupPreferencesBridge["set"]>().mockResolvedValue(true)
  await mount(platform, { get: async () => ({ openAtLogin: false, showInDock: null }), set })
  expect(container.textContent).not.toContain("在 Dock 中显示")
  const openAtLogin = toggle("开机自动启动")
  expect(openAtLogin.getAttribute("aria-checked")).toBe("false")
  await act(async () => openAtLogin.click())
  expect(set).toHaveBeenCalledExactlyOnceWith("openAtLogin", true)
  expect(openAtLogin.getAttribute("aria-checked")).toBe("true")
})

it("在 macOS 显示 Dock 开关，保存失败时保留原值", async () => {
  const set = vi
    .fn<StartupPreferencesBridge["set"]>()
    .mockRejectedValueOnce(new Error("unavailable"))
    .mockResolvedValueOnce(false)
  await mount("darwin", { get: async () => ({ openAtLogin: false, showInDock: true }), set })
  const dock = toggle("在 Dock 中显示")
  expect(dock.getAttribute("aria-checked")).toBe("true")
  await act(async () => dock.click())
  expect(dock.getAttribute("aria-checked")).toBe("true")
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("启动设置暂不可用")
  await act(async () => dock.click())
  expect(set).toHaveBeenLastCalledWith("showInDock", false)
  expect(dock.getAttribute("aria-checked")).toBe("false")
  expect(container.querySelector('[role="alert"]')).toBeNull()
})

async function mount(
  platform: string,
  startupPreferences: StartupPreferencesBridge,
): Promise<void> {
  vi.stubGlobal("pigclaude", { platform, startupPreferences })
  await act(async () =>
    root.render(
      createElement(AppProviders, {
        children: createElement(GeneralSettings, { appVersion: null }),
      }),
    ),
  )
}

function toggle(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="' + label + '"]',
  )
  if (!button) throw new Error("找不到设置开关 " + label)
  return button
}
