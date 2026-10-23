// 验证授予组件在权限、路由和会话变化后不接受迟到写入或关闭新表单。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useNavigate } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { GrantDialog } from "./grant-dialog"
import { fillGrant, setupPickerDom } from "./grant-test-support"
import { adminSessionGeneration } from "@/lib/session-generation"
const api = vi.hoisted(() => ({
  create: vi.fn(),
  preview: vi.fn(),
  list: vi.fn(),
  search: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("@/lib/api", () => ({
  adminApi: {
    membership: { grants: api, tiers: { list: api.list }, users: { search: api.search } },
  },
}))
vi.mock("sonner", () => ({ toast: { success: api.success, error: api.error } }))
setupPickerDom()
beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue({ items: [{ id: "vip", name: "VIP", enabled: true }] })
  api.search.mockResolvedValue({
    items: [
      {
        userId: "u1",
        email: "user@example.test",
        tier: null,
        validUntil: null,
        status: "none",
      },
    ],
  })
  api.preview.mockResolvedValue({
    tier: { name: "VIP", code: "vip", level: 1, cardStyle: "azure" },
    validUntil: "2026-12-01",
    voidedRemainingSeconds: "0",
    voidedValueFen: "0",
    convertedSeconds: "0",
  })
})
it.each(["permission", "route", "session", "closed"])(
  "ignores late create after %s",
  async (mode) => {
    let resolve: (value: unknown) => void = () => {}
    api.create.mockReturnValueOnce(
      new Promise((accept) => {
        resolve = accept
      }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const close = vi.fn(),
      granted = vi.fn()
    function Harness({ canWrite, open }: { canWrite: boolean; open: boolean }) {
      const navigate = useNavigate()
      return (
        <>
          <button onClick={() => void navigate("/other")}>换路由</button>
          <GrantDialog open={open} canWrite={canWrite} onOpenChange={close} onGranted={granted} />
        </>
      )
    }
    function tree(canWrite = true, open = true) {
      return (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Harness canWrite={canWrite} open={open} />
          </MemoryRouter>
        </QueryClientProvider>
      )
    }
    const view = render(tree())
    await fillGrant("manual")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(false),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    expect(api.create).toHaveBeenCalledTimes(1)
    if (mode === "permission") view.rerender(tree(false))
    if (mode === "closed") view.rerender(tree(true, false))
    if (mode === "session") adminSessionGeneration.invalidate()
    if (mode === "route") fireEvent.click(screen.getByText("换路由"))
    await act(async () => resolve({ status: "active" }))
    expect(invalidate).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(granted).not.toHaveBeenCalled()
    expect(api.success).not.toHaveBeenCalled()
    expect(api.error).not.toHaveBeenCalled()
  },
)
it.each(["input-roundtrip", "close-reopen", "session"])(
  "cannot submit a completed preview after %s",
  async (mode) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function tree(open = true) {
      return (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <GrantDialog open={open} onOpenChange={vi.fn()} onGranted={vi.fn()} />
          </MemoryRouter>
        </QueryClientProvider>
      )
    }
    const view = render(tree())
    await fillGrant("manual")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(false),
    )
    api.preview.mockReturnValue(new Promise(() => {}))
    if (mode === "input-roundtrip") {
      fireEvent.change(screen.getByLabelText("时长"), { target: { value: "2" } })
      fireEvent.change(screen.getByLabelText("时长"), { target: { value: "1" } })
    }
    if (mode === "close-reopen") {
      view.rerender(tree(false))
      view.rerender(tree())
    }
    if (mode === "session") adminSessionGeneration.invalidate()
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    expect(api.create).not.toHaveBeenCalled()
    if (mode !== "session") {
      expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(true)
      expect(screen.queryByText(/^生效后：VIP，到期 /)).toBeNull()
    }
  },
)
