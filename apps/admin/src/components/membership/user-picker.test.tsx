// 验证正式用户选择器的防抖、键盘选择和有效会员摘要。
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { UserPick } from "@pigclaude/api/membership/types"
import { UserPicker } from "./user-picker"
import { adminSessionGeneration } from "@/lib/session-generation"
const search = vi.hoisted(() => vi.fn())
vi.mock("@/lib/api", () => ({ adminApi: { membership: { users: { search } } } }))
const user: UserPick = {
  userId: "u1",
  email: "a@example.test",
  tierName: "SVIP",
  validUntil: "2026-12-01T00:00:00Z",
  status: "active",
}
function mount() {
  function Harness() {
    const [value, onChange] = useState<UserPick | null>(null)
    return <UserPicker value={value} onChange={onChange} />
  }
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  )
}
async function tick(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
function query(text = "a") {
  fireEvent.click(screen.getByRole("button", { name: "选择用户" }))
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
  search.mockResolvedValue({ items: [user] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Element.prototype, "scrollIntoView")
})
it("searches by email and selects with keyboard", async () => {
  mount()
  query("a@example.test")
  await tick(249)
  expect(search).not.toHaveBeenCalled()
  await tick(1)
  expect(search).toHaveBeenCalledWith("a@example.test")
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" })
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" })
  expect(screen.getByText("a@example.test")).toBeTruthy()
  expect(screen.getByRole("button", { name: "清除用户" })).toBeTruthy()
})
it("shows membership summary", async () => {
  mount()
  query()
  await tick()
  expect(screen.getByText("SVIP · 2026-12-01 到期")).toBeTruthy()
  expect(screen.getByText("u1")).toBeTruthy()
})
it.each(["expired", "revoked"] as const)("does not present %s as active", async (status) => {
  search.mockResolvedValue({ items: [{ ...user, status }] })
  mount()
  query()
  await tick()
  expect(screen.getByText("无会员")).toBeTruthy()
})
it("empty state for no match", async () => {
  search.mockResolvedValue({ items: [] })
  mount()
  query()
  await tick()
  expect(screen.getByText("未找到用户")).toBeTruthy()
})
it("does not search after session expires during debounce", async () => {
  mount()
  query()
  await tick(100)
  adminSessionGeneration.invalidate()
  await tick(150)
  expect(search).not.toHaveBeenCalled()
})
it("ignores superseded search and closed popover replies", async () => {
  let resolve: (value: { items: UserPick[] }) => void = () => {}
  search.mockReturnValueOnce(
    new Promise<{ items: UserPick[] }>((accept) => {
      resolve = accept
    }),
  )
  mount()
  query()
  await tick()
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "new" } })
  await act(async () => resolve({ items: [{ ...user, email: "old@example.test" }] }))
  expect(screen.queryByText("old@example.test")).toBeNull()
  await tick()
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" })
  expect(screen.queryByRole("option")).toBeNull()
})
it("clears a selected chip and searches again", async () => {
  mount()
  query()
  await tick()
  fireEvent.click(screen.getByRole("option"))
  fireEvent.click(screen.getByRole("button", { name: "清除用户" }))
  query("b")
  await tick()
  expect(search).toHaveBeenLastCalledWith("b")
})
it.each(["query-roundtrip", "close-reopen"])(
  "does not offer completed search results after %s",
  async (mode) => {
    mount()
    query()
    await tick()
    expect(screen.getByRole("option")).toBeTruthy()
    if (mode === "query-roundtrip") {
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } })
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } })
    } else {
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" })
      fireEvent.click(screen.getByRole("button", { name: "选择用户" }))
    }
    expect(screen.queryByRole("option")).toBeNull()
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" })
    expect(screen.queryByRole("button", { name: "清除用户" })).toBeNull()
    await tick(249)
    expect(screen.queryByRole("option")).toBeNull()
    await tick(1)
    expect(screen.getByRole("option")).toBeTruthy()
    expect(search).toHaveBeenCalledTimes(2)
  },
)
it("cannot select a completed result after session expires without rerender", async () => {
  mount()
  query()
  await tick()
  adminSessionGeneration.invalidate()
  fireEvent.click(screen.getByRole("option"))
  expect(screen.queryByRole("button", { name: "清除用户" })).toBeNull()
})
