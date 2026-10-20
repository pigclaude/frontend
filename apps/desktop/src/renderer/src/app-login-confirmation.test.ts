// 负责验证浏览器授权完成后先确认会员：有效直接进入引导，无效回登录页显示门禁提示。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { AuthorizationStateEvent } from "../../main/authorization/types"
import { DesktopApp } from "./app"
import { membershipGateMessage } from "./models/membership-view"

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({ resolved: "dark" }),
}))
vi.mock("./main-window", () => ({
  MainWindow: ({ screen }: { screen: string }) =>
    createElement("main", { "data-screen": screen }, screen),
}))

function view(state: MembershipView["state"], revision: number): MembershipView {
  return {
    startupPhase: "settled",
    revision,
    state,
    account: null,
    productCode: "pigclaude",
    planKind: "week",
    lifetime: false,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: "2",
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
  }
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

/** 装好一个只会在授权完成后改变会员结果的桌面桥。 */
function installBridge() {
  let publishAuthorization: (event: AuthorizationStateEvent) => void = () => undefined
  let afterCompletion: () => Promise<MembershipView> = async () => view("signed_out", 1)
  let completed = false
  const inspect = vi.fn(async () => (completed ? afterCompletion() : view("signed_out", 1)))
  window.pigclaude = {
    platform: "darwin",
    onAuthorizationState: (listener) => {
      publishAuthorization = listener
      return () => {}
    },
    startAuthorization: async () => ({
      ok: true,
      sessionId: "fresh",
      authorizationUrl: "http://127.0.0.1:8788/authorize/fresh",
      expiresAt: Date.now() + 600_000,
    }),
    membership: {
      inspect,
      subscribe: () => () => {},
      withdraw: async () => view("signed_out", 9),
      signOut: async () => view("signed_out", 9),
    },
  }
  return {
    inspect,
    resolveWith(next: () => Promise<MembershipView>) {
      afterCompletion = next
    },
    complete() {
      completed = true
      publishAuthorization({
        purpose: "pigclaude-login",
        mode: "login",
        sessionId: "fresh",
        status: "completed",
        displayName: "林舟",
        expiresAt: Date.now() + 600_000,
      })
    },
  }
}

async function clickLogin(): Promise<void> {
  const login = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "登录",
  )
  await act(async () => login?.click())
}

function screen(): string | null | undefined {
  return container.querySelector("[data-screen]")?.getAttribute("data-screen")
}

describe("desktop login membership confirmation", () => {
  it("enters onboarding directly when membership becomes active", async () => {
    const bridge = installBridge()
    let settle: (value: MembershipView) => void = () => undefined
    bridge.resolveWith(() => new Promise((resolve) => (settle = resolve)))
    await act(async () => root.render(createElement(DesktopApp)))
    await clickLogin()
    expect(container.textContent).toContain("请在浏览器中继续")

    await act(async () => bridge.complete())
    expect(container.textContent).toContain("正在确认会员…")
    expect(container.textContent).not.toContain("开始使用")
    expect(screen()).toBeUndefined()

    await act(async () => settle(view("active", 2)))
    expect(screen()).toBe("onboarding")
    expect(container.textContent).not.toContain("正在确认会员…")
  })

  it.each(["verification_required", "expired", "device_revoked"] as const)(
    "returns to login with the gate message when membership is %s",
    async (state) => {
      const bridge = installBridge()
      bridge.resolveWith(async () => view(state, 2))
      await act(async () => root.render(createElement(DesktopApp)))
      await clickLogin()

      await act(async () => bridge.complete())

      const message = membershipGateMessage(view(state, 2))
      expect(message).toBeTruthy()
      expect(container.textContent).toContain("欢迎使用 PigClaude")
      expect(container.textContent).toContain(message ?? "")
      expect(container.textContent).not.toContain("正在确认会员…")
      expect(container.textContent).not.toContain("请在浏览器中继续")
      expect(screen()).toBeUndefined()
      expect(bridge.inspect.mock.calls.length).toBeGreaterThanOrEqual(2)
    },
  )

  it("returns to login when the membership check itself fails", async () => {
    const bridge = installBridge()
    bridge.resolveWith(async () => Promise.reject(new Error("offline")))
    await act(async () => root.render(createElement(DesktopApp)))
    await clickLogin()

    await act(async () => bridge.complete())

    expect(container.textContent).toContain("欢迎使用 PigClaude")
    expect(container.textContent).not.toContain("正在确认会员…")
    expect(screen()).toBeUndefined()
  })
})
