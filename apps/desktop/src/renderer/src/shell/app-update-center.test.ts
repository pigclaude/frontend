// 验证顶栏更新中心：只显示 PigClaude 应用这一行，显示进度和失败详情，动作和发布说明都走桌面桥。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateResult } from "../../../main/updates/update-service"
import { AppProviders } from "../app-providers"
import { installPigcodeNative } from "../lib/pigcode-native"
import { AppUpdateCenter } from "./app-update-center"

const releaseUrl = "https://github.com/pigclaude/release/releases/tag/v1.1.0"
const available: DesktopUpdateState = {
  autoCheck: true,
  phase: "available",
  currentVersion: "1.0.0",
  version: "1.1.0",
  url: releaseUrl,
  action: "download",
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
  delete window.pigcodeNative
  vi.unstubAllGlobals()
})

function installUpdates(initial: DesktopUpdateState) {
  let current = initial
  const listeners = new Set<(state: DesktopUpdateState) => void>()
  const updates = {
    state: vi.fn(async () => current),
    perform: vi.fn(async () => current),
    check: vi.fn(async (): Promise<UpdateResult> => ({ status: "up-to-date" })),
    setAutoCheck: vi.fn(async () => current),
    openReleaseNotes: vi.fn(async () => undefined),
    subscribe: (listener: (state: DesktopUpdateState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  window.pigclaude = { platform: "darwin", updates }
  installPigcodeNative(window)
  const push = async (next: DesktopUpdateState) => {
    current = next
    await act(async () => listeners.forEach((listener) => listener(next)))
  }
  return { updates, push }
}

async function render(): Promise<void> {
  await act(async () =>
    root.render(createElement(AppProviders, null, createElement(AppUpdateCenter))),
  )
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === name || item.getAttribute("aria-label") === name,
  )
  if (!found) throw new Error(`没有找到按钮 ${name}`)
  return found
}

async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}

describe("顶栏更新中心", () => {
  it("没有新版本时不占位置", async () => {
    installUpdates({ ...available, phase: "idle", version: null, url: null, action: null })
    await render()
    expect(document.querySelector('[aria-label="查看更新"]')).toBeNull()
  })

  it("只列出 PigClaude 这一行，显示版本和下载进度", async () => {
    const { push } = installUpdates(available)
    await render()
    await click("查看更新")
    const rows = document.querySelectorAll(".update-center-row")
    expect(rows).toHaveLength(1)
    expect(rows[0]?.querySelector(".update-center-name")?.textContent).toBe("PigClaude")
    expect(rows[0]?.textContent).toContain("1.0.0 → 1.1.0")

    await push({ ...available, phase: "downloading", progress: 42 })
    expect(document.querySelector(".update-center-meta")?.textContent).toBe("正在下载 42%")
  })

  it("下载、检查和发布说明都走桌面桥，失败时显示原因", async () => {
    const { updates, push } = installUpdates(available)
    await render()
    await click("查看更新")
    await click("下载")
    expect(updates.perform).toHaveBeenCalledTimes(1)
    await click("检查更新")
    expect(updates.check).toHaveBeenCalledTimes(1)

    await push({ ...available, phase: "failed", error: "download" })
    expect(document.querySelector(".update-center-meta")?.textContent).toBe("下载失败，可以重试")
    await act(async () => document.querySelector<HTMLElement>(".update-center-summary")?.click())
    await click("查看发布说明")
    expect(updates.openReleaseNotes).toHaveBeenCalledTimes(1)
  })

  it("应用行消失后再检查失败，弹层显示失败而不是全部最新", async () => {
    const idle = { ...available, phase: "idle", version: null, url: null, action: null } as const
    const { updates, push } = installUpdates(available)
    await render()
    await click("查看更新")
    updates.check.mockImplementationOnce(async () => {
      await push(idle)
      return { status: "up-to-date" }
    })
    await click("检查更新")
    expect(document.querySelectorAll(".update-center-row")).toHaveLength(0)

    updates.check.mockImplementationOnce(async () => {
      await push({ ...idle, phase: "failed", error: "check", action: "open-release" })
      return { status: "error" }
    })
    await click("检查更新")
    expect(document.querySelector(".update-center-error")?.textContent).toBe("暂时无法检查更新")
  })
})
