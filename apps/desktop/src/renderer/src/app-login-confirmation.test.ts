// 负责验证浏览器授权完成后先确认会员：有效直接进入引导，无效回登录页显示门禁提示。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  AuthorizationRequest,
  AuthorizationStartResult,
  AuthorizationStateEvent,
} from "../../main/authorization/types"
import { DesktopApp } from "./app"

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
    tier: { code: "vip", name: "VIP", level: 1 },
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

/** 带账号的有效会员：引导按账号记标记，没有 userId 时不会进引导。 */
function activeFor(userId: string, revision: number): MembershipView {
  return {
    ...view("active", revision),
    account: { userId, nickname: "u", email: "u@example.com", avatar: "" },
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

/** 装好一个只会在授权完成后改变会员结果的桌面桥。 */
function installBridge(preparing?: Promise<AuthorizationStartResult>) {
  let publishAuthorization: (event: AuthorizationStateEvent) => void = () => undefined
  let publishMembership: (next: MembershipView) => void = () => undefined
  let afterCompletion: () => Promise<MembershipView> = async () => view("signed_out", 1)
  let completed = false
  let rejectCancellation = false
  const inspect = vi.fn(async () => (completed ? afterCompletion() : view("signed_out", 1)))
  const start = vi.fn<(request: AuthorizationRequest) => Promise<AuthorizationStartResult>>(
    async () =>
      preparing ?? {
        ok: true,
        sessionId: "fresh",
        authorizationUrl: "http://127.0.0.1:8788/authorize/fresh",
        expiresAt: Date.now() + 600_000,
      },
  )
  const cancel = vi.fn<(id: string) => Promise<AuthorizationStateEvent>>(async () => ({
    purpose: "pigclaude-login",
    mode: "login",
    sessionId: "fresh",
    status: rejectCancellation ? "committing" : "cancelled",
  }))
  window.pigclaude = {
    platform: "darwin",
    onAuthorizationState: (listener) => {
      publishAuthorization = listener
      return () => {}
    },
    startAuthorization: start,
    cancelAuthorization: cancel,
    membership: {
      inspect,
      subscribe: (listener) => {
        publishMembership = listener
        return () => {}
      },
      withdraw: async () => view("signed_out", 9),
      signOut: async () => view("signed_out", 9),
    },
  }
  return {
    inspect,
    start,
    cancel,
    opened() {
      publishAuthorization({
        purpose: "pigclaude-login",
        mode: "login",
        sessionId: "fresh",
        status: "browser-open",
        authorizationUrl: "http://127.0.0.1:8788/authorize/fresh",
        expiresAt: Date.now() + 600_000,
      })
    },
    publishMembership(next: MembershipView) {
      publishMembership(next)
    },
    lockCancellation() {
      rejectCancellation = true
    },
    saving() {
      publishAuthorization({
        purpose: "pigclaude-login",
        mode: "login",
        sessionId: "fresh",
        status: "committing",
      })
    },
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
  for (const progress of ["saving", "completed"] as const) {
    it.each(["success", "failure", "throw"])(
      `ignores a late start %s after ${progress}`,
      async (ending) => {
        let finish: (value: AuthorizationStartResult) => void = () => undefined
        let fail: (error: Error) => void = () => undefined
        const bridge = installBridge(
          new Promise((resolve, reject) => {
            finish = resolve
            fail = reject
          }),
        )
        bridge.resolveWith(async () => activeFor("user-b", 2))
        await act(async () => root.render(createElement(DesktopApp)))
        await clickLogin()
        await act(async () => bridge.opened())
        await act(async () => (progress === "saving" ? bridge.saving() : bridge.complete()))
        await act(async () => {
          if (ending === "throw") fail(new Error("late launch failure"))
          else if (ending === "failure")
            finish({ ok: false, status: "network-error", error: "late launch failure" })
          else
            finish({
              ok: true,
              sessionId: "fresh",
              authorizationUrl: "http://127.0.0.1:8788/authorize/fresh",
              expiresAt: Date.now() + 600_000,
            })
        })
        expect(container.textContent).not.toContain("等待浏览器授权")
        expect(container.textContent).not.toContain("late launch failure")
        if (progress === "saving") expect(container.textContent).toContain("正在保存授权…")
        else expect(screen()).toBe("onboarding")
      },
    )
  }
  it("does not let a background active result interrupt an explicit authorization", async () => {
    const bridge = installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await clickLogin()
    await act(async () => bridge.publishMembership(activeFor("user-a", 2)))
    expect(container.textContent).toContain("等待浏览器授权")
    expect(screen()).toBeUndefined()
    await act(async () => bridge.saving())
    await act(async () => bridge.publishMembership(activeFor("user-a", 3)))
    expect(container.textContent).toContain("正在保存授权…")
    expect(screen()).toBeUndefined()
  })
  it("cancels browser preparation using the original request identity before a session id arrives", async () => {
    let finish: (result: AuthorizationStartResult) => void = () => undefined
    const bridge = installBridge(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await act(async () => root.render(createElement(DesktopApp)))
    await clickLogin()
    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "取消",
    )
    await act(async () => cancel?.click())
    const request = bridge.start.mock.calls[0]?.[0]
    expect(request).toHaveProperty("clientRequestId", expect.any(String))
    expect(bridge.cancel).toHaveBeenCalledWith(request?.clientRequestId)
    await act(async () =>
      finish({
        ok: true,
        sessionId: "old",
        authorizationUrl: "http://127.0.0.1:8788/old",
        expiresAt: 999_000,
      }),
    )
    expect(container.textContent).toContain("欢迎使用 PigClaude")
    expect(container.textContent).not.toContain("等待浏览器授权")
  })
  it("keeps accepting completion when a queued cancel reaches the commit boundary", async () => {
    const bridge = installBridge()
    bridge.lockCancellation()
    bridge.resolveWith(async () => activeFor("user-b", 2))
    await act(async () => root.render(createElement(DesktopApp)))
    await clickLogin()
    const cancel = [...container.querySelectorAll("button")].find((b) => b.textContent === "取消")
    await act(async () => cancel?.click())
    expect(container.textContent).toContain("正在保存授权…")
    await act(async () => bridge.complete())
    expect(screen()).toBe("onboarding")
  })
  it("shows an entered save without cancellation or premature membership checks", async () => {
    const bridge = installBridge()
    await act(async () => root.render(createElement(DesktopApp)))
    await clickLogin()
    const checks = bridge.inspect.mock.calls.length
    await act(async () => bridge.saving())
    expect(container.textContent).toContain("正在保存授权…")
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "取消")).toBe(
      false,
    )
    expect(bridge.inspect.mock.calls.length).toBe(checks)
    expect(screen()).toBeUndefined()
  })
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

    await act(async () => settle(activeFor("u1", 2)))
    expect(screen()).toBe("onboarding")
    expect(container.textContent).not.toContain("正在确认会员…")
  })

  it.each(["verification_required", "expired", "device_revoked"] as const)(
    "shows the actual recovery state when membership is %s",
    async (state) => {
      const bridge = installBridge()
      bridge.resolveWith(async () => view(state, 2))
      await act(async () => root.render(createElement(DesktopApp)))
      await clickLogin()

      await act(async () => bridge.complete())

      const title = {
        verification_required: "设备需要重新授权",
        expired: "会员已到期",
        device_revoked: "设备授权已撤销",
      }[state]
      expect(container.querySelector("h1")?.textContent).toBe(title)
      expect(container.textContent).not.toContain("正在确认会员…")
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
