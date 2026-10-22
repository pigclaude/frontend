// 负责用真实 React effects 验证会员退出保持、失败可见和迟到检查隔离。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type {
  AuthorizationStartResult,
  AuthorizationStateEvent,
} from "../../main/authorization/types"
import { DesktopApp } from "./app"

const fixture = vi.hoisted(() => ({ logout: (): void => undefined }))

vi.mock("./hooks/use-appearance", () => ({
  useAppearance: () => ({ resolved: "dark" }),
}))
vi.mock("./main-window", () => ({
  MainWindow: ({ screen, onLogout }: { screen: string; onLogout: () => void }) => {
    fixture.logout = onLogout
    return createElement("main", { "data-screen": screen }, screen)
  },
}))

function view(state: MembershipView["state"], revision = 1): MembershipView {
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

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  window.localStorage.setItem("pigclaude-appearance", "appearance-sentinel")
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete window.pigclaude
  vi.unstubAllGlobals()
})

describe("DesktopApp local sign-out", () => {
  it.each(["active"] as const)(
    "keeps %s users on login after authoritative local sign-out",
    async (state) => {
      const signOut = vi.fn(async () => view("signed_out", 2))
      window.pigclaude = {
        platform: "darwin",
        membership: {
          inspect: async () => view(state),
          subscribe: () => () => {},
          signOut,
          withdraw: async () => view("signed_out", 2),
        },
      }
      await act(async () => root.render(createElement(DesktopApp)))
      expect(container.querySelector("[data-screen]")?.getAttribute("data-screen")).toBe("chat")

      await act(async () => fixture.logout())

      expect(container.textContent).toContain("欢迎使用 PigClaude")
      expect(container.querySelector("[data-screen]")).toBeNull()
      expect(signOut).toHaveBeenCalledOnce()
      expect(window.localStorage.getItem("pigclaude-appearance")).toBe("appearance-sentinel")
    },
  )

  it("shows a failed local cleanup and retries instead of silently restoring active", async () => {
    let fail = true
    window.pigclaude = {
      platform: "darwin",
      startAuthorization: async () => ({
        ok: true,
        sessionId: "fresh",
        authorizationUrl: "http://127.0.0.1:8788/authorize/fresh",
        expiresAt: Date.now() + 600_000,
      }),
      membership: {
        inspect: async () => view("active"),
        subscribe: () => () => {},
        withdraw: async () => view("signed_out", 3),
        signOut: async () => {
          if (fail) throw new Error("fixture disk unavailable")
          return view("signed_out", 3)
        },
      },
    }
    await act(async () => root.render(createElement(DesktopApp)))
    await act(async () => fixture.logout())

    expect(container.textContent).toContain("退出登录失败")
    expect(container.querySelector("[data-screen]")).toBeNull()
    fail = false
    const retry = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("重试退出"),
    )
    expect(retry).toBeDefined()
    await act(async () => retry?.click())
    expect(container.textContent).toContain("欢迎使用 PigClaude")
    expect(container.textContent).not.toContain("退出登录失败")
    const login = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "登录",
    )
    expect(login?.disabled).toBe(false)
    await act(async () => login?.click())
    expect(container.textContent).toContain("请在浏览器中继续")
  })

  it("ignores an older inspect response delivered after local sign-out", async () => {
    let resolveInspect: (value: MembershipView) => void = () => undefined
    let publish: (value: MembershipView) => void = () => undefined
    window.pigclaude = {
      platform: "darwin",
      membership: {
        inspect: () => new Promise((resolve) => (resolveInspect = resolve)),
        subscribe: (listener) => {
          publish = listener
          return () => {}
        },
        withdraw: async () => view("signed_out", 3),
        signOut: async () => view("signed_out", 3),
      },
    }
    await act(async () => root.render(createElement(DesktopApp)))
    await act(async () => publish(view("active", 2)))
    await act(async () => fixture.logout())
    await act(async () => resolveInspect(view("active", 1)))

    expect(container.textContent).toContain("欢迎使用 PigClaude")
    expect(container.querySelector("[data-screen]")).toBeNull()
  })

  it("ignores an old authorization promise and terminal events after sign-out and a fresh start", async () => {
    let publishMembership: (value: MembershipView) => void = () => undefined
    let publishAuthorization: (value: AuthorizationStateEvent) => void = () => undefined
    let finishOldStart: (value: AuthorizationStartResult) => void = () => undefined
    let starts = 0
    window.pigclaude = {
      platform: "darwin",
      onAuthorizationState: (listener) => {
        publishAuthorization = listener
        return () => {}
      },
      startAuthorization: async () => {
        if (++starts === 1) return new Promise((resolve) => (finishOldStart = resolve))
        return {
          ok: true,
          sessionId: "fresh",
          authorizationUrl: "http://127.0.0.1:8788/authorize/fresh",
          expiresAt: Date.now() + 600_000,
        }
      },
      membership: {
        inspect: async () => view("signed_out"),
        subscribe: (listener) => {
          publishMembership = listener
          return () => {}
        },
        withdraw: async () => view("signed_out", 3),
        signOut: async () => view("signed_out", 3),
      },
    }
    await act(async () => root.render(createElement(DesktopApp)))
    const clickLogin = () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "登录")
        ?.click()
    await act(async () => clickLogin())
    await act(async () => publishMembership(view("active", 2)))
    await act(async () => fixture.logout())
    await act(async () => clickLogin())
    await act(async () => {
      finishOldStart({
        ok: true,
        sessionId: "old",
        authorizationUrl: "http://127.0.0.1:8788/authorize/old",
        expiresAt: Date.now() + 600_000,
      })
      publishAuthorization({
        purpose: "pigclaude-login",
        mode: "login",
        sessionId: "old",
        status: "completed",
        displayName: "OldUser",
        expiresAt: Date.now() + 600_000,
      })
      publishAuthorization({
        purpose: "pigclaude-login",
        mode: "login",
        sessionId: "old",
        status: "cancelled",
      })
    })
    expect(container.textContent).toContain("请在浏览器中继续")
    expect(container.textContent).not.toContain("OldUser")
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const copy = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "复制链接",
    )
    await act(async () => copy?.click())
    expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:8788/authorize/fresh")
    await act(async () =>
      publishAuthorization({
        purpose: "pigclaude-login",
        mode: "login",
        sessionId: "fresh",
        status: "completed",
        displayName: "FreshUser",
        expiresAt: Date.now() + 600_000,
      }),
    )
    expect(container.textContent).not.toContain("请在浏览器中继续")
    expect(container.textContent).toContain("欢迎使用 PigClaude")
    expect(container.textContent).toContain("请先在浏览器中登录并授权这台设备。")
  })
})
