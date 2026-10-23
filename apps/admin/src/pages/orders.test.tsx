// 负责验证订单统计、服务端筛选、冻结快照详情和身份隔离。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter, useNavigate } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { formatFen, formatTime } from "@pigclaude/web-ui/lib/format"
import OrdersPage from "./orders"
import type { AdminOrder } from "@pigclaude/api/membership/types"
import { adminSessionGeneration } from "@/lib/session-generation"
const mocks = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), tiers: vi.fn() }))
vi.mock("@/lib/api", () => ({
  adminApi: {
    membership: {
      orders: { list: mocks.list, summary: mocks.summary },
      tiers: { list: mocks.tiers },
    },
  },
}))
const row: AdminOrder = {
  orderNo: "PC-review-12345678",
  userId: "buyer",
  email: "buyer@test",
  kind: "purchase",
  tierName: "历史等级",
  tierCode: "vip",
  cardStyle: "gold",
  purpose: "upgrade_remaining",
  optionPriceFen: "1000",
  paidAt: "2026-10-22T01:00:00Z",
  expiresAt: "2026-10-23T00:00:00Z",
  months: null,
  listPriceFen: "9007199254740993",
  creditFen: "1340",
  payableFen: "100",
  paidFen: "100",
  payType: "alipay",
  gatewayTradeNo: "gateway-full-123",
  status: "activated",
  creditShortfallFen: "0",
  createdAt: "2026-10-22T00:00:00Z",
  activatedAt: "2026-10-22T01:02:03.123456Z",
}
function Navigation() {
  const navigate = useNavigate()
  return <button onClick={() => void navigate("/", { replace: true })}>同路由重入</button>
}
function mount(permissions = ["payment:read"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["admin-me"], { id: "ops", status: "active", permissions })
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OrdersPage />
        <Navigation />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...view }
}
async function loaded() {
  return screen.findByText("PC-rev…78")
}
async function selectTier() {
  fireEvent.click(screen.getByRole("combobox", { name: "订单等级" }))
  fireEvent.click(await screen.findByRole("option", { name: "已删除等级" }))
}
beforeEach(() => {
  mocks.list.mockReset()
  mocks.summary.mockReset()
  mocks.tiers.mockReset()
  mocks.summary.mockResolvedValue({
    todayPaidFen: "128460",
    monthPaidFen: "987654",
    monthActivatedCount: 42,
    needsReviewCount: 2,
    pendingCount: 3,
  })
  mocks.list.mockResolvedValue({
    items: [
      row,
      {
        ...row,
        orderNo: "PC-shortfall-4567",
        status: "needs_review",
        creditShortfallFen: "23",
        paidFen: null,
      },
    ],
    filterTiers: [{ id: "deleted", name: "已删除等级", cardStyle: "rose" }],
    nextCursor: "opaque+/cursor",
  })
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
it("summary cards show server totals and attention count", async () => {
  const { client } = mount()
  expect(await screen.findByText(formatFen("128460"))).toBeTruthy()
  expect(screen.getByText(formatFen("987654"))).toBeTruthy()
  expect(screen.getByText("42")).toBeTruthy()
  expect(within(screen.getByRole("tab", { name: /待处理/ })).getByText("2")).toBeTruthy()
  expect(client.getQueryData(["admin-orders-summary", "ops"])).toBeTruthy()
  const card = screen.getByRole("button", { name: "待处理订单 2" })
  expect(card.className).toContain("border-danger")
  fireEvent.click(card)
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ needsReview: true })),
  )
})
it("attention tab queries needsReview and status tab clears it", async () => {
  mount()
  await loaded()
  fireEvent.mouseDown(screen.getByRole("tab", { name: "已过期" }), { button: 0, ctrlKey: false })
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "expired" })),
  )
  fireEvent.mouseDown(screen.getByRole("tab", { name: /待处理/ }), { button: 0, ctrlKey: false })
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ needsReview: true, status: undefined }),
    ),
  )
  fireEvent.mouseDown(screen.getByRole("tab", { name: "待支付" }), { button: 0, ctrlKey: false })
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "pending", needsReview: undefined }),
    ),
  )
  fireEvent.mouseDown(screen.getByRole("tab", { name: "全部" }), { button: 0, ctrlKey: false })
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined, needsReview: undefined }),
    ),
  )
})
it("no visible native controls and historical tier uses server metadata", async () => {
  const { container } = mount()
  await loaded()
  expect(container.querySelector('input[type="checkbox"]')).toBeNull()
  for (const element of container.querySelectorAll("select")) {
    expect(element.getAttribute("aria-hidden")).toBe("true")
    expect(element.tabIndex).toBe(-1)
  }
  const trigger = screen.getByRole("combobox", { name: "订单等级" })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: "ArrowDown" })
  expect(await screen.findByRole("option", { name: "已删除等级" })).toBeTruthy()
  fireEvent.click(screen.getByRole("option", { name: "已删除等级" }))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ tierId: "deleted" })),
  )
  expect((await screen.findByText("已删除等级")).getAttribute("data-style")).toBe("rose")
  expect(mocks.tiers).not.toHaveBeenCalled()
})
it("passes opaque cursor and resets after filter; search submits on Enter", async () => {
  mount()
  await loaded()
  fireEvent.click(screen.getByRole("button", { name: "下一页" }))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "opaque+/cursor" }),
    ),
  )
  await selectTier()
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined, tierId: "deleted" }),
    ),
  )
  fireEvent.change(screen.getByLabelText("搜索订单"), { target: { value: " buyer " } })
  fireEvent.submit(screen.getByLabelText("搜索订单").closest("form")!)
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: "buyer", tierId: "deleted", limit: 20 }),
    ),
  )
})
it("date drafts apply and clear inclusive bounds without immediate requests", async () => {
  mount()
  await loaded()
  const calls = mocks.list.mock.calls.length
  fireEvent.click(screen.getByRole("button", { name: "时间范围" }))
  fireEvent.change(screen.getByLabelText("起始时间"), { target: { value: "2026-10-21T00:00" } })
  fireEvent.change(screen.getByLabelText("截止时间"), { target: { value: "2026-10-23T00:00" } })
  expect(mocks.list.mock.calls.length).toBe(calls)
  fireEvent.click(screen.getByRole("button", { name: "应用" }))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: new Date("2026-10-21T00:00").toISOString(),
        to: new Date("2026-10-23T00:00").toISOString(),
      }),
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "时间范围" }))
  fireEvent.click(screen.getByRole("button", { name: "清除" }))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: undefined, to: undefined }),
    ),
  )
})
it("row opens detail with frozen breakdown and timeline", async () => {
  mount()
  fireEvent.click(await loaded())
  const detail = within(await screen.findByRole("dialog"))
  for (const text of [
    row.orderNo,
    row.gatewayTradeNo!,
    row.email,
    row.userId,
    "剩余价值抵扣",
    "−¥13.40",
    "会员生效",
    "支付到账",
    "档位价",
    "剩余升级",
    formatFen(row.listPriceFen),
  ])
    expect(detail.getByText(text)).toBeTruthy()
  expect(detail.getByText(formatTime(row.activatedAt!))).toBeTruthy()
  expect(detail.queryByText(/T01:02:03/)).toBeNull()
  fireEvent.click(detail.getByRole("button", { name: "关闭" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  fireEvent.keyDown((await loaded()).closest("tr")!, { key: "Enter" })
  expect(await screen.findByRole("dialog")).toBeTruthy()
})
it("shortfall shows warning not red row and unpaid remains explicit", async () => {
  mount()
  await loaded()
  const warning = screen.getByText("少收 ¥0.23")
  const tr = warning.closest("tr")!
  expect(tr.className).not.toContain("text-destructive")
  expect(within(tr).getByLabelText("少收警示")).toBeTruthy()
  expect(within(tr).getByText("待处理").getAttribute("data-variant")).toBe("danger")
  fireEvent.click(tr)
  const detail = within(await screen.findByRole("dialog"))
  expect(detail.getByText("未支付")).toBeTruthy()
  expect(detail.getByText("少收")).toBeTruthy()
  expect(detail.getByText("¥0.23")).toBeTruthy()
})
it("expired detail uses expiry and monthly product purpose", async () => {
  mocks.list.mockResolvedValue({
    items: [
      {
        ...row,
        status: "expired",
        months: 3,
        purpose: "renew",
        activatedAt: null,
        paidAt: null,
        paidFen: null,
      },
    ],
    filterTiers: [],
    nextCursor: null,
  })
  mount()
  fireEvent.click(await loaded())
  const detail = within(await screen.findByRole("dialog"))
  expect(detail.getByText("3 个月")).toBeTruthy()
  expect(detail.getByText("续费")).toBeTruthy()
  expect(detail.getByText(`已过期 ${formatTime(row.expiresAt)}`)).toBeTruthy()
  expect(detail.queryByText("会员生效")).toBeNull()
})
it("copy stops row opening and reports success, rejection and missing clipboard", async () => {
  mount()
  const tr = (await loaded()).closest("tr")!
  const copy = within(tr).getByRole("button", { name: "复制单号" })
  fireEvent.keyDown(copy, { key: "Enter" })
  fireEvent.click(copy)
  await waitFor(() => expect(within(tr).getByRole("status").textContent).toBe("已复制"))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(row.orderNo)
  expect(screen.queryByRole("dialog")).toBeNull()
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"))
  fireEvent.click(copy)
  await waitFor(() =>
    expect(within(tr).getByRole("status").textContent).toBe("复制失败，请手动复制"),
  )
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
  fireEvent.click(copy)
  await waitFor(() =>
    expect(within(tr).getByRole("status").textContent).toBe("浏览器不支持复制，请手动复制"),
  )
  fireEvent.click(tr)
  const detail = within(await screen.findByRole("dialog"))
  expect(detail.getByRole("button", { name: "复制平台流水" })).toBeTruthy()
})
it("summary failure keeps list usable and retry restores cards", async () => {
  mocks.summary.mockRejectedValueOnce(new Error("summary failed"))
  mount()
  await loaded()
  expect(await screen.findByRole("button", { name: "重试统计" })).toBeTruthy()
  expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4)
  fireEvent.mouseDown(screen.getByRole("tab", { name: "已关闭" }), { button: 0, ctrlKey: false })
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "closed" })),
  )
  fireEvent.click(screen.getByRole("button", { name: "重试统计" }))
  expect(await screen.findByText(formatFen("128460"))).toBeTruthy()
})
it("refresh invalidates summary and resets pagination", async () => {
  mount()
  await loaded()
  await screen.findByText(formatFen("128460"))
  fireEvent.click(screen.getByRole("button", { name: "下一页" }))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "opaque+/cursor" }),
    ),
  )
  const before = mocks.summary.mock.calls.length
  fireEvent.click(screen.getByRole("button", { name: "刷新" }))
  await waitFor(() => expect(mocks.summary.mock.calls.length).toBe(before + 1))
  await waitFor(() =>
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: undefined })),
  )
})
it("does not query without payment read", () => {
  mount(["membership:read"])
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.summary).not.toHaveBeenCalled()
  expect(screen.getByText("无权查看订单")).toBeTruthy()
})
it("list error retries and null cursor disables pagination", async () => {
  mocks.list.mockRejectedValueOnce(new Error("network"))
  mount()
  await screen.findByText("订单加载失败")
  mocks.list.mockResolvedValue({ items: [], filterTiers: [], nextCursor: null })
  fireEvent.click(screen.getByRole("button", { name: "重试订单" }))
  expect(await screen.findByText("暂无订单")).toBeTruthy()
  expect((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(true)
})
for (const change of ["identity", "location", "session"] as const) {
  it(`clears details and drafts on ${change} owner transition`, async () => {
    const { client } = mount()
    await loaded()
    fireEvent.change(screen.getByLabelText("搜索订单"), { target: { value: "旧身份草稿" } })
    fireEvent.click(screen.getByRole("button", { name: "时间范围" }))
    fireEvent.change(screen.getByLabelText("起始时间"), { target: { value: "2026-10-21T00:00" } })
    fireEvent.keyDown(screen.getByLabelText("起始时间"), { key: "Escape" })
    fireEvent.click(await loaded())
    await screen.findByRole("dialog")
    if (change === "identity")
      await act(() =>
        client.setQueryData(["admin-me"], {
          id: "other",
          status: "active",
          permissions: ["payment:read"],
        }),
      )
    if (change === "location")
      fireEvent.click(screen.getByRole("button", { name: "同路由重入", hidden: true }))
    if (change === "session")
      await act(() => {
        adminSessionGeneration.invalidate()
        client.setQueryData(["admin-me"], {
          id: "ops",
          email: "same-owner-new-session",
          status: "active",
          permissions: ["payment:read"],
        })
      })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByRole("tab", { name: "全部" }).getAttribute("data-state")).toBe("active")
    expect((screen.getByLabelText("搜索订单") as HTMLInputElement).value).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "时间范围" }))
    expect((screen.getByLabelText("起始时间") as HTMLInputElement).value).toBe("")
  })
}
