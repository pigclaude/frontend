// 验证被引用的配置不可删除，正在使用的配置也不可编辑。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import type { BrowserProfileView } from "@pigclaude/contracts/browser-profile"
import type { BrowserProfilesController } from "../hooks/use-browser-profiles"
import { BrowserProfilesScreen } from "./browser-profiles-screen"

it("浏览器实例配置使用中和被引用时限制相应操作", async () => {
  const profile: BrowserProfileView = {
    id: "shared",
    name: "共享环境",
    proxyId: null,
    fingerprint: {
      seed: "1",
      brand: "Chrome",
      platform: "linux",
      lang: "en-US",
      timezone: "UTC",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    revision: 1,
    boundAccounts: [{ id: "a", name: "测试账号" }],
    inUse: true,
    createdAt: "",
    updatedAt: "",
  }
  const host = document.createElement("div")
  const root = createRoot(host)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const controller: BrowserProfilesController = {
    profiles: [profile],
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    save: vi.fn(),
    remove: vi.fn(),
    region: vi.fn(),
  }
  const render = (current: BrowserProfileView) =>
    act(async () =>
      root.render(
        createElement(BrowserProfilesScreen, {
          controller: { ...controller, profiles: [current] },
          proxies: [],
        }),
      ),
    )
  const button = (name: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${name} 共享环境"]`)
  try {
    await render(profile)
    expect(button("编辑")?.disabled).toBe(true)
    expect(button("删除")?.disabled).toBe(true)
    await render({ ...profile, inUse: false })
    expect(button("编辑")?.disabled).toBe(false)
    expect(button("删除")?.disabled).toBe(true)
    await render({ ...profile, inUse: false, boundAccounts: [] })
    expect(button("删除")?.disabled).toBe(false)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
