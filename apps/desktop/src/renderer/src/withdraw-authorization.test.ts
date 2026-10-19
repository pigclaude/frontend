// 负责验证真实 renderer 在会员失效时仍显示独立的设备关系撤销入口。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { DesktopApp } from "./app"
import { membershipView } from "../../main/testing/profile-fixture"

vi.mock("./hooks/use-appearance", () => ({ useAppearance: () => ({ resolved: "dark" }) }))
it("inactive account can withdraw without invoking ordinary sign-out or sending identity", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const withdraw = vi.fn(async () => membershipView("signed_out"))
  const signOut = vi.fn(async () => membershipView("signed_out"))
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => ({
        ...membershipView("verification_required"),
        account: { userId: "user", nickname: "", email: "", avatar: "" },
      }),
      subscribe: () => () => {},
      withdraw,
      signOut,
    },
  }
  try {
    await act(async () => root.render(createElement(DesktopApp)))
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "撤销本机授权",
    )
    expect(button).toBeDefined()
    await act(async () => button?.click())
    expect(withdraw).toHaveBeenCalledWith()
    expect(signOut).not.toHaveBeenCalled()
    expect(container.textContent).toContain("全部 profile")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    delete window.pigclaude
    vi.unstubAllGlobals()
  }
})
