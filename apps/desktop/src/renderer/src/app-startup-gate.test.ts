// 负责验证已登录用户启动时从「正在连接」直接进入引导或主界面，中间不闪出可操作的登录页。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { DesktopApp } from "./app"
import { markOnboardingSeen } from "./lib/onboarding-storage"
import { initialMembershipView } from "./models/membership-view"

const rendered = vi.hoisted(() => ({ screens: [] as string[] }))

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({ resolved: "dark" }),
}))
vi.mock("./main-window", () => ({
  MainWindow: ({ screen }: { screen: string }) => {
    rendered.screens.push(screen)
    return createElement("main", { "data-screen": screen })
  },
}))
vi.mock("./screens/onboarding-screen", () => ({
  OnboardingScreen: () => {
    rendered.screens.push("onboarding")
    return createElement("div", { "data-screen": "onboarding" })
  },
}))
vi.mock("./screens/login-screen", () => ({
  LoginScreen: ({ gateMessage }: { gateMessage?: string }) => {
    const phase = gateMessage?.startsWith("正在连接") ? "connecting" : "login"
    rendered.screens.push(phase)
    return createElement("div", { "data-screen": phase })
  },
}))

function active(userId: string): MembershipView {
  return {
    ...initialMembershipView(),
    startupPhase: "settled",
    revision: 1,
    state: "active",
    account: { userId, nickname: "u", email: "u@example.com", avatar: "" },
  }
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  window.localStorage.clear()
  rendered.screens = []
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

/** 装一个启动检查要等测试放行的桥，这样能看到「正在连接」到第一屏之间画过的每一屏。 */
function installBridge(userId: string): () => void {
  let settle: (view: MembershipView) => void = () => undefined
  const pending = new Promise<MembershipView>((resolve) => (settle = resolve))
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: () => pending,
      subscribe: () => () => {},
      withdraw: async () => active(userId),
      signOut: async () => active(userId),
    },
  }
  return () => settle(active(userId))
}

/** 去掉相邻重复，只留下屏幕切换的顺序。 */
function sequence(): string[] {
  return rendered.screens.filter((screen, index, all) => screen !== all[index - 1])
}

describe("desktop startup gate", () => {
  it("goes from connecting straight to onboarding for an unseen account", async () => {
    const settle = installBridge("u1")
    await act(async () => root.render(createElement(DesktopApp)))
    expect(sequence()).toEqual(["connecting"])

    await act(async () => settle())

    expect(sequence()).toEqual(["connecting", "onboarding"])
  })

  it("goes from connecting straight to chat for a seen account", async () => {
    markOnboardingSeen("u1", window.localStorage)
    const settle = installBridge("u1")
    await act(async () => root.render(createElement(DesktopApp)))

    await act(async () => settle())

    expect(sequence()).toEqual(["connecting", "chat"])
  })
})
