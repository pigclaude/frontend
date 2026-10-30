// 负责验证全屏引导的出现时机：会员有效时按账号只出现一次，稍后再说或做完才写标记；Claude 授权页取消回到第 2 步，授权完成进到第 3 步，进度不丢。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  ClaudeAccountEvent,
  ClaudeAccountView,
  ProxyView,
} from "@pigclaude/contracts/claude-account"
import { DesktopApp } from "./app"
import { initialMembershipView } from "./models/membership-view"
import { markOnboardingSeen, onboardingSeenKey } from "./lib/onboarding-storage"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({ resolved: "dark" }),
}))
vi.mock("./main-window", () => ({
  MainWindow: ({ screen }: { screen: string }) =>
    createElement("main", { "data-screen": screen, "data-main-window": "" }, screen),
}))

function active(userId: string): MembershipView {
  return {
    ...initialMembershipView(),
    startupPhase: "settled",
    revision: 1,
    state: "active",
    account: { userId, nickname: "林舟", email: "lin@example.com", avatar: "" },
  }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  window.localStorage.clear()
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

/** 装好会员有效的桥；返回值把 Claude 账号登录事件推给界面。 */
function installBridge(userId = "u1"): (event: ClaudeAccountEvent) => void {
  let publish: (event: ClaudeAccountEvent) => void = () => undefined
  let account: ClaudeAccountView | null = null
  const proxy: ProxyView = {
    id: "la-01",
    name: "LA-01",
    url: "http://127.0.0.1:1",
    lastTest: {
      ok: true,
      ip: "203.0.113.42",
      latencyMs: 1,
      testedAt: "2026-10-21T00:00:00.000Z",
    },
  }
  const view = (): ClaudeAccountView => ({
    id: "acc-1",
    displayName: "主力 Max",
    enabled: true,
    email: "user@example.com",
    subscriptionType: "max",
    needsReauth: false,
    credentialExpiresAt: 4_102_444_800_000,
    proxyId: "la-01",
    fingerprint: {
      seed: "123456",
      brand: "Chrome",
      platform: "macos",
      lang: "en-US",
      timezone: "America/Los_Angeles",
      canvasNoise: "1",
      clientRectsNoise: "1",
    },
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  })
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => active(userId),
      subscribe: () => () => {},
      withdraw: async () => active(userId),
      signOut: async () => active(userId),
    },
    claudeAccounts: {
      list: async () => (account === null ? [] : [account]),
      authorize: async () => {
        account = view()
        publish({
          accountId: "acc-1",
          phase: "waiting-browser",
          errorCode: null,
          message: null,
        })
        await Promise.resolve()
        publish({
          accountId: "acc-1",
          phase: "authorized",
          errorCode: null,
          message: null,
        })
        return account
      },
      cancelAuthorization: async () => undefined,
      update: async () => account ?? view(),
      remove: async () => undefined,
      importFromClaudeCli: async () => account ?? view(),
      subscribe: (listener) => {
        publish = listener
        return () => undefined
      },
    },
    proxies: {
      list: async () => [proxy],
      save: async () => proxy,
      remove: async () => undefined,
      test: async () => proxy,
    },
    egress: { check: async () => ({ ok: true, ip: "203.0.113.42" }) },
  }
  return (event) => publish(event)
}

function screen(): string | null | undefined {
  return container.querySelector("[data-screen]")?.getAttribute("data-screen")
}

function button(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
}

function progress(): (string | null)[] {
  return [...container.querySelectorAll(".onboarding-progress li")].map((item) =>
    item.getAttribute("data-state"),
  )
}

async function click(name: string): Promise<void> {
  const target = button(name)
  expect(target, name).toBeDefined()
  await act(async () => target?.click())
}

describe("desktop onboarding gate", () => {
  it("shows full-screen onboarding once for an unseen account", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))

    expect(screen()).toBe("onboarding")
    expect(container.querySelector("[data-main-window]")).toBeNull()
    expect(container.textContent).toContain("第 1 步，共 3 步")
    expect(container.textContent).toContain("添加一个代理")
    expect(container.textContent).toContain("代理可选")
    expect(container.textContent).not.toContain("林舟")
  })

  it("skips onboarding for a seen account", async () => {
    markOnboardingSeen("u1", window.localStorage)
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))

    expect(screen()).toBe("chat")
    expect(container.querySelector("[data-main-window]")).not.toBeNull()
  })

  it("marks seen on 稍后再说", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await click("稍后再说")

    expect(window.localStorage.getItem(onboardingSeenKey("u1"))).toBe("1")
    expect(screen()).toBe("chat")
  })

  it("marks seen on finishing after skipping every step", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    expect(container.textContent).toContain("第 2 步，共 3 步")
    expect(container.textContent).toContain("添加 Claude 账号")
    expect(container.textContent).toContain(
      "绑定代理时出口和代理一致才会继续；不绑定则使用系统网络",
    )
    await click("跳过")
    expect(container.textContent).toContain("第 3 步，共 3 步")
    expect(window.localStorage.getItem(onboardingSeenKey("u1"))).toBeNull()
    await click("开始第一个会话")

    expect(window.localStorage.getItem(onboardingSeenKey("u1"))).toBe("1")
    expect(screen()).toBe("chat")
  })

  it("shows onboarding again after restart when it was not finished", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    await act(async () => root.unmount())

    root = createRoot(container)
    await act(async () => root.render(createElement(DesktopApp)))
    expect(screen()).toBe("onboarding")
    expect(container.textContent).toContain("第 1 步，共 3 步")
  })

  it("returns to the account step after the Claude authorization screen closes", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    await click("添加账号")
    expect(screen()).not.toBe("onboarding")
    expect(container.textContent).toContain("取消")

    await click("取消")

    expect(screen()).toBe("onboarding")
    expect(container.textContent).toContain("第 2 步，共 3 步")
    expect(progress()).toEqual(["skipped", "current", "todo"])
    expect(window.localStorage.getItem(onboardingSeenKey("u1"))).toBeNull()
  })

  it("keeps the finished proxy step after a cancelled Claude authorization", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    const input = container.querySelector<HTMLInputElement>('input[aria-label="代理地址"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setValue?.call(input, "http://user:pass@host:8000")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("测试并添加")
    expect(progress()).toEqual(["done", "current", "todo"])
    await click("添加账号")
    await click("取消")

    expect(container.textContent).toContain("第 2 步，共 3 步")
    expect(progress()).toEqual(["done", "current", "todo"])
  })

  it("coalesces double clicks and waits for the old authorization to finish before retry", async () => {
    const publish = installBridge()
    const accounts = window.pigclaude?.claudeAccounts
    if (!accounts) throw new Error("missing synthetic account bridge")
    let starts = 0
    let rejectOld: (error: Error) => void = () => undefined
    let release: () => void = () => undefined
    const cleanup = new Promise<void>((resolve) => {
      release = resolve
    })
    accounts.authorize = async () => {
      starts++
      publish({ accountId: "acc-1", phase: "waiting-browser", errorCode: null, message: null })
      return await new Promise<ClaudeAccountView>((_resolve, reject) => {
        if (starts === 1) rejectOld = reject
      })
    }
    accounts.cancelAuthorization = async () => {
      await cleanup
      publish({
        accountId: "acc-1",
        phase: "cancelled",
        errorCode: "AUTHORIZATION_CANCELLED",
        message: "取消",
      })
    }
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    await click("添加账号")
    await click("下一步")
    await click("绑定代理")
    await click("保存并核对出口")
    const start = button("开始核对并授权")
    expect(start).toBeDefined()
    await act(async () => {
      start?.click()
      start?.click()
    })
    expect(starts).toBe(1)
    const retry = button("重新发起")
    expect(retry).toBeDefined()
    await act(async () => {
      retry?.click()
      retry?.click()
    })
    expect(starts).toBe(1)
    await act(async () => {
      release()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(starts).toBe(2)
    await act(async () => {
      rejectOld(new Error("授权已取消"))
      await Promise.resolve()
    })
    expect(container.textContent).toContain("等待浏览器确认")
    expect(container.textContent).not.toContain("授权已取消")
  })

  it("keeps the authorization screen open when saving cannot be cancelled", async () => {
    const publish = installBridge()
    const accounts = window.pigclaude?.claudeAccounts
    if (!accounts) throw new Error("missing synthetic account bridge")
    accounts.cancelAuthorization = async () => {
      throw new Error("授权正在保存，请稍候")
    }
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    await click("添加账号")
    await act(async () => {
      publish({ accountId: "acc-1", phase: "waiting-browser", errorCode: null, message: null })
    })
    await click("取消")
    expect(container.textContent).toContain("授权正在保存，请稍候")
    expect(container.textContent).toContain("等待浏览器确认")
  })

  it("shows a browser cleanup warning without treating a saved account as failed", async () => {
    const publish = installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    await click("添加账号")
    await act(async () => {
      publish({
        accountId: "acc-1",
        phase: "authorized",
        errorCode: "BROWSER_STOP_FAILED",
        message: "浏览器可能仍在运行",
      })
    })
    expect(container.textContent).toContain("已加入号池")
    expect(container.textContent).toContain("浏览器可能仍在运行")
    expect(container.textContent).toContain("回到账号")
  })

  it("moves on to the session step after the Claude authorization finishes", async () => {
    installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    await click("添加账号")
    await click("下一步")
    await click("绑定代理")
    await click("保存并核对出口")
    await click("开始核对并授权")
    await act(async () => {
      await Promise.resolve()
    })
    await click("回到账号")

    expect(screen()).toBe("onboarding")
    expect(container.textContent).toContain("第 3 步，共 3 步")
    expect(container.textContent).toContain("开始第一个会话")
    expect(progress()).toEqual(["skipped", "done", "current"])
    expect(window.localStorage.getItem(onboardingSeenKey("u1"))).toBeNull()
  })
})
