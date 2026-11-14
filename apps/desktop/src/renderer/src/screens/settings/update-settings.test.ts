// 验证设置页的应用更新：「通用」页的开关和手动检查走桌面桥，「关于」页显示真实的版本和更新状态。

// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "../../app-providers"
import { GeneralSettings } from "./settings-app-pages"
import { AboutSettings } from "./settings-system-pages"

const idle: DesktopUpdateState = {
  autoCheck: true,
  phase: "idle",
  currentVersion: "1.0.0",
  version: null,
  url: null,
  action: null,
  progress: null,
  error: null,
}

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
  delete window.pigclaude
  vi.unstubAllGlobals()
})

function installUpdates(initial: DesktopUpdateState) {
  let current = initial
  const updates = {
    state: vi.fn(async () => current),
    perform: vi.fn(async () => current),
    check: vi.fn(async () => ({ status: "update-available" as const, version: "1.1.0" })),
    setAutoCheck: vi.fn(async (value: boolean) => (current = { ...current, autoCheck: value })),
    openReleaseNotes: vi.fn(async () => undefined),
    subscribe: () => () => undefined,
  }
  window.pigclaude = { platform: "darwin", updates }
  return updates
}

async function render(children: ReactNode): Promise<void> {
  await act(async () => root.render(createElement(AppProviders, null, children)))
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function control(selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`没有找到 ${selector}`)
  return element
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name,
  )
  if (!found) throw new Error(`没有找到按钮 ${name}`)
  return found
}

describe("「通用」页的更新", () => {
  it("开关显示主进程保存的值，改动写回主进程", async () => {
    const updates = installUpdates({ ...idle, autoCheck: false })
    await render(createElement(GeneralSettings, { appVersion: "1.0.0" }))
    const toggle = control('[aria-label="自动检查更新"]')
    expect(toggle.getAttribute("aria-checked")).toBe("false")
    expect(container.textContent).toContain("当前版本 1.0.0")

    await act(async () => toggle.click())
    expect(updates.setAutoCheck).toHaveBeenCalledWith(true)
    expect(toggle.getAttribute("aria-checked")).toBe("true")
  })

  it("手动检查后显示结果", async () => {
    const updates = installUpdates(idle)
    await render(createElement(GeneralSettings, { appVersion: "1.0.0" }))
    await act(async () => button("检查更新").click())
    expect(updates.check).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("可以更新到 1.1.0")
  })

  it("更新失败时可以打开主进程给出的下载页", async () => {
    const updates = installUpdates({
      ...idle,
      phase: "failed",
      error: "check",
      url: "https://github.com/pigclaude/release/releases/latest",
      action: "open-release",
    })
    await render(createElement(GeneralSettings, { appVersion: "1.0.0" }))
    await act(async () => button("打开下载页").click())
    expect(updates.openReleaseNotes).toHaveBeenCalledTimes(1)
  })

  it("没有桌面桥时开关显示占位符，检查不可用", async () => {
    await render(createElement(GeneralSettings, { appVersion: null }))
    expect(container.querySelector('[aria-label="自动检查更新"]')).toBeNull()
    expect(container.textContent).toContain("自动检查更新当前版本 ——")
    expect(button("检查更新").disabled).toBe(true)
  })
})

describe("「关于」页的更新状态", () => {
  it("显示版本和主进程给出的更新状态", async () => {
    installUpdates({ ...idle, phase: "downloading", version: "1.1.0", progress: 42 })
    await render(createElement(AboutSettings, { appVersion: "1.0.0" }))
    expect(container.textContent).toContain("PigClaude1.0.0")
    expect(container.textContent).toContain("更新状态正在下载 42%")
  })

  it("没有待安装的更新时不声称检查过", async () => {
    installUpdates(idle)
    await render(createElement(AboutSettings, { appVersion: "1.0.0" }))
    expect(container.textContent).toContain("更新状态没有待安装的更新")
  })
})
