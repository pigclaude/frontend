// 负责验证恢复页面解释可信会员事实、隐藏缺失字段并调用已有恢复动作。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { membershipView } from "../../../main/testing/profile-fixture"
import { RecoveryScreen } from "./recovery-screen"

it("shows verified expiry and historical tier without a welcome or fictional account", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const onCheck = vi.fn(async () => undefined)
  const onAuthorize = vi.fn()
  try {
    await act(async () =>
      root.render(
        createElement(RecoveryScreen, {
          membership: {
            ...membershipView("expired"),
            account: {
              userId: "real-id-hidden",
              nickname: "阿青",
              email: "a@example.test",
              avatar: "",
            },
            membershipValidUntil: "2026-01-01T00:00:00Z",
            recovery: {
              status: "expired",
              grantExpiresAt: "2030-01-01T00:00:00Z",
              canRevoke: false,
            },
          },
          onCheck,
          onAuthorize,
        }),
      ),
    )
    expect(container.querySelector("h1")?.textContent).toBe("会员已到期")
    expect(container.textContent).toContain("阿青")
    expect(container.textContent).toContain("a@example.test")
    expect(container.textContent).toContain("上次会员：VIP")
    expect(container.textContent).not.toContain("real-id-hidden")
    expect(container.textContent).not.toContain("欢迎使用")
    const check = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "重新检查",
    )
    await act(async () => check?.click())
    expect(onCheck).toHaveBeenCalledWith()
    expect(onAuthorize).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})

it("opens renew from verified expiry once and keeps unknown failures on retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  const root = createRoot(container)
  let finish!: () => void
  const open = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const props = { onCheck: vi.fn(async () => undefined), onAuthorize: vi.fn(), onOpenWebsite: open }
  try {
    await act(async () =>
      root.render(
        createElement(RecoveryScreen, {
          ...props,
          membership: {
            ...membershipView("expired"),
            recovery: {
              status: "expired",
              grantExpiresAt: "2030-01-01T00:00:00Z",
              canRevoke: false,
            },
          },
        }),
      ),
    )
    const renew = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "续费会员",
    )
    expect(renew).toBeDefined()
    await act(async () => {
      renew?.click()
      renew?.click()
    })
    expect(open).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await act(async () =>
      root.render(createElement(RecoveryScreen, { ...props, membership: membershipView("error") })),
    )
    expect(container.textContent).not.toContain("续费会员")
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})

it("starts an explicit account switch from the current blocked identity", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  const root = createRoot(container)
  const onAuthorize = vi.fn()
  try {
    await act(async () =>
      root.render(
        createElement(RecoveryScreen, {
          membership: membershipView("expired"),
          onCheck: async () => undefined,
          onAuthorize,
        }),
      ),
    )
    const button = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "切换账号",
    )
    expect(button).toBeDefined()
    await act(async () => button?.click())
    expect(onAuthorize).toHaveBeenCalledWith("switch")
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
