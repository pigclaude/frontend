// 负责验证全屏引导的出现时机：会员有效时按账号只出现一次，稍后再说或做完才写标记，Claude 授权页回来停在第 2 步。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { AuthorizationStateEvent } from "../../main/authorization/types"
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

/** 装好会员有效的桥；返回值把 Claude 账号授权事件推给界面。 */
function installBridge(userId = "u1"): (event: AuthorizationStateEvent) => void {
  let publish: (event: AuthorizationStateEvent) => void = () => undefined
  window.pigclaude = {
    platform: "darwin",
    authorization: {
      start: async () => ({
        ok: true,
        sessionId: "claude-1",
        authorizationUrl: "https://claude.example/authorize",
        expiresAt: Date.now() + 60_000,
      }),
      cancel: async () => ({
        sessionId: "claude-1",
        purpose: "claude-account",
        mode: "authorize",
        status: "cancelled",
      }),
      subscribe: (listener) => {
        publish = listener
        return () => undefined
      },
    },
    membership: {
      inspect: async () => active(userId),
      subscribe: () => () => {},
      withdraw: async () => active(userId),
      signOut: async () => active(userId),
    },
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
    expect(window.localStorage.getItem(onboardingSeenKey("u1"))).toBeNull()
  })

  it("returns to the account step after the Claude authorization finishes", async () => {
    const publish = installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await click("跳过")
    await click("添加账号")
    await click("下一步")
    await click("绑定 LA-01")
    await click("保存并核对出口")
    await click("重新核对")
    await click("打开浏览器授权")
    await act(async () =>
      publish({
        sessionId: "claude-1",
        purpose: "claude-account",
        mode: "authorize",
        status: "completed",
      }),
    )

    await click("回到账号")

    expect(screen()).toBe("onboarding")
    expect(container.textContent).toContain("第 2 步，共 3 步")
    expect(window.localStorage.getItem(onboardingSeenKey("u1"))).toBeNull()
  })
})
