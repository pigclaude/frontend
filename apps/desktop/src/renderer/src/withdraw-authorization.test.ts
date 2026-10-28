// 验证恢复页将撤销收进更多操作，确认先说明范围，取消、目标变化和重复点击不会误发撤销。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { WithdrawAuthorization } from "./components/withdraw-authorization"
import { DesktopApp } from "./app"
import { membershipView } from "../../main/testing/profile-fixture"
vi.mock("./hooks/use-appearance", () => ({ useAppearance: () => ({ resolved: "dark" }) }))
let root: Root, container: HTMLDivElement
const confirmation = {
  confirmationId: "confirm-a",
  account: { nickname: "A", email: "a@example.test" },
  expiresAt: "2030-01-01T00:00:00Z",
}
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
function button(text: string) {
  return [...document.querySelectorAll("button")].find((b) => b.textContent === text)
}
function install() {
  let emit: (view: MembershipView) => void = () => undefined
  const view: MembershipView = {
    ...membershipView("expired"),
    actionContextId: "context-a",
    account: { userId: "a", nickname: "A", email: "a@example.test", avatar: "" },
    recovery: { status: "expired", canRevoke: true, grantExpiresAt: "2030-01-01T00:00:00Z" },
  }
  const prepare = vi.fn(async () => confirmation),
    withdraw = vi.fn(async () => membershipView("signed_out")),
    signOut = vi.fn(async () => membershipView("signed_out"))
  window.pigclaude = {
    platform: "darwin",
    membership: {
      inspect: async () => view,
      subscribe: (listener) => {
        emit = listener
        return () => {}
      },
      prepareWithdrawal: prepare,
      withdraw,
      signOut,
    },
  }
  return {
    prepare,
    withdraw,
    signOut,
    change: () =>
      emit({
        ...view,
        revision: 9,
        actionContextId: "context-b",
        account: { userId: "b", nickname: "B", email: "b@example.test", avatar: "" },
      }),
  }
}
async function openConfirmation() {
  const more = button("更多操作")
  expect(more).toBeDefined()
  await act(async () =>
    more?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  )
  const revoke = [...document.querySelectorAll('[role="menuitem"]')].find(
    (item) => item.textContent === "撤销本机授权",
  )
  expect(revoke).toBeDefined()
  await act(async () => (revoke as HTMLElement)?.click())
}
it("keeps expired-account withdrawal behind more and cancellation sends no mutation", async () => {
  const f = install()
  await act(async () => root.render(createElement(DesktopApp)))
  expect(button("撤销本机授权")).toBeUndefined()
  await openConfirmation()
  expect(f.prepare).toHaveBeenCalledWith("context-a")
  expect(document.body.textContent).toContain("a@example.test")
  expect(document.body.textContent).toContain("全部相关桌面授权")
  expect(document.body.textContent).toContain("其他设备")
  expect(document.body.textContent).toContain("网站登录会话")
  expect(document.body.textContent).not.toContain("profile")
  await act(async () => button("取消")?.click())
  expect(f.withdraw).not.toHaveBeenCalled()
  expect(f.signOut).not.toHaveBeenCalled()
})
it("confirms once with only the main-generated confirmation identifier", async () => {
  const f = install()
  let finish!: () => void
  f.withdraw.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(membershipView("signed_out"))
      }),
  )
  await act(async () => root.render(createElement(DesktopApp)))
  await openConfirmation()
  const submit = button("确认撤销")
  await act(async () => {
    submit?.click()
    submit?.click()
  })
  expect(f.withdraw).toHaveBeenCalledTimes(1)
  expect(f.withdraw).toHaveBeenCalledWith("confirm-a")
  expect(button("取消")?.disabled).toBe(true)
  await act(async () => finish())
})
it("invalidates the displayed confirmation when the logical account changes", async () => {
  const f = install()
  await act(async () => root.render(createElement(DesktopApp)))
  await openConfirmation()
  const old = button("确认撤销")
  await act(async () => f.change())
  expect(button("确认撤销")).toBeUndefined()
  await act(async () => old?.click())
  expect(f.withdraw).not.toHaveBeenCalled()
  expect(container.textContent).toContain("b@example.test")
})

it("reports lack of permission without offering a false successful withdrawal", async () => {
  const f = install()
  f.prepare.mockRejectedValue(new Error("insufficient_scope"))
  await act(async () => root.render(createElement(DesktopApp)))
  await openConfirmation()
  expect(button("确认撤销")).toBeUndefined()
  expect(document.body.textContent).toContain("缺少撤销权限")
  expect(f.withdraw).not.toHaveBeenCalled()
})
it("uses the same confirmation protection from the existing settings entry", async () => {
  const f = install()
  await act(async () =>
    root.render(createElement(WithdrawAuthorization, { contextId: "context-a" })),
  )
  await act(async () => button("撤销本机授权")?.click())
  expect(button("确认撤销")).toBeDefined()
  expect(f.withdraw).not.toHaveBeenCalled()
  await act(async () => button("取消")?.click())
  expect(f.withdraw).not.toHaveBeenCalled()
})
