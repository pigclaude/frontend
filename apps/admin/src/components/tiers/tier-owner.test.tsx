// 验证防抖、输入变化、路由、权限和会话失效后的预览及保存归属。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, useNavigate } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Tier } from "@pigclaude/api/membership/types"
import { TierEditor } from "./tier-editor"
import { adminSessionGeneration } from "@/lib/session-generation"
const api = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn() }))
vi.mock("@/lib/api", () => ({ adminApi: { membership: { tiers: api } } }))
const tier: Tier = {
  id: "original",
  name: "VIP",
  code: "vip",
  level: 1,
  monthlyPriceFen: "10000",
  tagline: "",
  cardStyle: "azure",
  benefits: [],
  enabled: true,
  options: [
    {
      id: "option",
      months: 3,
      discountKind: "none",
      discountValue: "0",
      badge: null,
      recommended: false,
      enabled: true,
      priceFen: "30000",
      perMonthFen: "10000",
      monthlyPurchaseFen: "30000",
      savedFen: "0",
    },
  ],
}
function deferred() {
  let resolve: (value: Tier) => void = () => {}
  const promise = new Promise<Tier>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}
function result(priceFen: string): Tier {
  return { ...tier, options: [{ ...tier.options[0], priceFen }] }
}
function Navigation() {
  const navigate = useNavigate()
  return <button onClick={() => void navigate("/other")}>换路由</button>
}
function mount(canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const close = vi.fn()
  const invalidate = vi.spyOn(client, "invalidateQueries")
  function tree(write: boolean) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Navigation />
          <TierEditor tier={tier} identity="admin" canWrite={write} onClose={close} />
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  const view = render(tree(canWrite))
  return {
    ...view,
    close,
    invalidate,
    changePermission: (write = false) => view.rerender(tree(write)),
  }
}
async function tick(ms = 300) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.useFakeTimers()
  vi.clearAllMocks()
  api.preview.mockResolvedValue(result("27000"))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe("tier operation ownership", () => {
  it("renders a full-page editor instead of a sheet", () => {
    mount()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByRole("heading", { name: /编辑 VIP/ })).toBeTruthy()
    expect(screen.getByRole("region", { name: "用户端预览" })).toBeTruthy()
  })
  it("reports dirty state and uses onSaved after a successful save", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const onDirtyChange = vi.fn()
    const onSaved = vi.fn()
    const onClose = vi.fn()
    api.save.mockResolvedValue(tier)
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TierEditor
            tier={tier}
            identity="admin"
            canWrite
            onClose={onClose}
            onSaved={onSaved}
            onDirtyChange={onDirtyChange}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "新名称" } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    await act(async () => {})
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
  it("does not start preview after session changes during debounce", async () => {
    mount()
    await tick(100)
    adminSessionGeneration.invalidate()
    await tick(200)
    expect(api.preview).not.toHaveBeenCalled()
  })
  it("debounces for exactly 300 ms and suppresses superseded input replies", async () => {
    const old = deferred()
    api.preview.mockReturnValueOnce(old.promise)
    mount()
    await tick(299)
    expect(api.preview).not.toHaveBeenCalled()
    await tick(1)
    expect(api.preview).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText("月价（元）"), { target: { value: "200" } })
    expect(api.preview.mock.calls[0][1]()).toBe(false)
    await tick()
    expect(screen.getByText("现价 ¥270.00")).toBeTruthy()
    await act(async () => old.resolve(result("11100")))
    expect(screen.queryByText("现价 ¥111.00")).toBeNull()
    expect(screen.getByText("现价 ¥270.00")).toBeTruthy()
  })
  it.each(["permission", "route", "session", "unmount"])(
    "discards late preview after %s change",
    async (boundary) => {
      const response = deferred()
      api.preview.mockReturnValue(response.promise)
      const view = mount()
      await tick()
      if (boundary === "permission") view.changePermission()
      if (boundary === "route") fireEvent.click(screen.getByText("换路由"))
      if (boundary === "session") adminSessionGeneration.invalidate()
      if (boundary === "unmount") view.unmount()
      expect(api.preview.mock.calls[0][1]()).toBe(false)
      await act(async () => response.resolve(result("11100")))
      expect(screen.queryByText("现价 ¥111.00")).toBeNull()
    },
  )
  it.each(["permission", "route", "session", "unmount"])(
    "discards late save after %s change",
    async (boundary) => {
      const response = deferred()
      api.save.mockReturnValue(response.promise)
      const view = mount()
      fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
      if (boundary === "permission") view.changePermission()
      if (boundary === "route") fireEvent.click(screen.getByText("换路由"))
      if (boundary === "session") adminSessionGeneration.invalidate()
      if (boundary === "unmount") view.unmount()
      expect(api.save.mock.calls[0][2]()).toBe(false)
      await act(async () => response.resolve(tier))
      expect(view.close).not.toHaveBeenCalled()
      expect(view.invalidate).not.toHaveBeenCalled()
    },
  )
  it("never revives completed preview on ABA input", async () => {
    mount()
    await tick()
    expect(screen.getByText("现价 ¥270.00")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("月价（元）"), { target: { value: "200" } })
    fireEvent.change(screen.getByLabelText("月价（元）"), { target: { value: "100.00" } })
    expect(screen.queryByText("现价 ¥270.00")).toBeNull()
    await tick()
    expect(screen.getByText("现价 ¥270.00")).toBeTruthy()
  })
  it("old save finally cannot release the next permission owner's pending", async () => {
    const old = deferred()
    const next = deferred()
    api.save.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const view = mount()
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    view.changePermission()
    view.changePermission(true)
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "新草稿" } })
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    await act(async () => old.resolve(tier))
    expect(screen.getByRole("button", { name: "保存等级" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByLabelText("名称").getAttribute("value")).toBe("新草稿")
    expect(view.close).not.toHaveBeenCalled()
    expect(view.invalidate).not.toHaveBeenCalled()
    await act(async () => next.resolve(tier))
    expect(view.close).toHaveBeenCalledTimes(1)
  })
})
