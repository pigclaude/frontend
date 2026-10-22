// 负责验证订单只读权限、服务端筛选及不解释的翻页游标。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { formatTime } from "@pigclaude/web-ui/lib/format"
import OrdersPage from "./orders"
import type { AdminOrder } from "@pigclaude/api/membership/types"
const mocks = vi.hoisted(() => ({ list: vi.fn(), tiers: vi.fn() }))
vi.mock("@/lib/api", () => ({
  adminApi: { membership: { orders: { list: mocks.list }, tiers: { list: mocks.tiers } } },
}))
const row: AdminOrder = {
  orderNo: "PC-review",
  userId: "buyer",
  email: "buyer@test",
  kind: "purchase",
  tierName: "历史等级",
  months: 1,
  listPriceFen: "9007199254740993",
  creditFen: "10",
  payableFen: "100",
  paidFen: null,
  payType: "alipay",
  gatewayTradeNo: null,
  status: "needs_review",
  creditShortfallFen: "0",
  createdAt: "2026-10-22T00:00:00Z",
  activatedAt: null,
}
function mount(permissions = ["payment:read"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["admin-me"], { id: "ops", status: "active", permissions })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  mocks.list.mockReset()
  mocks.tiers.mockReset()
  mocks.list.mockResolvedValue({
    items: [
      row,
      { ...row, orderNo: "PC-shortfall", status: "activated", creditShortfallFen: "23" },
    ],
    filterTiers: [{ id: "deleted", name: "已删除等级" }],
    nextCursor: "opaque+/cursor",
  })
})
it("highlights needs_review and shortfall", async () => {
  mount()
  expect((await screen.findByText("PC-review")).closest("tr")?.className).toContain(
    "text-destructive",
  )
  expect(screen.getByText("PC-shortfall").closest("tr")?.className).toContain("text-destructive")
  expect(screen.getByText("少收 ¥0.23")).toBeTruthy()
  expect(screen.getAllByText(/¥90,071,992,547,409.93/)).toHaveLength(2)
})
it("filters pending review and passes opaque cursor; resets on filter", async () => {
  mount()
  await screen.findByText("PC-review")
  fireEvent.click(screen.getByLabelText("只看待处理"))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ needsReview: true, cursor: undefined }),
    ),
  )
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "下一页" }))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "opaque+/cursor" }),
    ),
  )
  fireEvent.click(screen.getByLabelText("只看少收"))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ stale: true, cursor: undefined }),
    ),
  )
  expect(mocks.tiers).not.toHaveBeenCalled()
  expect(screen.getByText("已删除等级")).toBeTruthy()
})
it("does not query without payment read", () => {
  mount(["membership:read"])
  expect(mocks.list).not.toHaveBeenCalled()
  expect(screen.getByText("无权查看订单")).toBeTruthy()
})
it("passes status, historical tier, search and inclusive date bounds to server", async () => {
  mount()
  await screen.findByText("PC-review")
  fireEvent.change(screen.getByLabelText("订单状态"), { target: { value: "expired" } })
  await screen.findByText("已删除等级")
  fireEvent.change(screen.getByLabelText("订单等级"), { target: { value: "deleted" } })
  fireEvent.change(screen.getByLabelText("搜索订单"), { target: { value: " buyer " } })
  fireEvent.click(screen.getByRole("button", { name: "搜索" }))
  fireEvent.change(screen.getByLabelText("起始时间"), { target: { value: "2026-10-21T00:00" } })
  fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2026-10-23T00:00" } })
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith({
      status: "expired",
      tierId: "deleted",
      q: "buyer",
      from: new Date("2026-10-21T00:00").toISOString(),
      to: new Date("2026-10-23T00:00").toISOString(),
      cursor: undefined,
      limit: 20,
    }),
  )
})
it("shows errors with retry and null cursor ends pagination", async () => {
  mocks.list.mockRejectedValueOnce(new Error("network"))
  mount()
  await screen.findByRole("alert")
  mocks.list.mockResolvedValue({ items: [], filterTiers: [], nextCursor: null })
  fireEvent.click(screen.getByRole("button", { name: "重试" }))
  await screen.findByText("暂无订单")
  expect((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(true)
})

it("formats both order timestamps without exposing raw ISO", async () => {
  mocks.list.mockResolvedValue({
    items: [{ ...row, activatedAt: "2026-10-22T01:02:03.123456Z" }],
    filterTiers: [],
    nextCursor: null,
  })
  mount()
  await screen.findByText(`创建：${formatTime(row.createdAt)}`)
  expect(screen.getByText(`生效：${formatTime("2026-10-22T01:02:03.123456Z")}`)).toBeTruthy()
  expect(screen.queryByText(/T01:02:03/)).toBeNull()
})
