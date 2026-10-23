// 验证购买记录延迟读取、游标追加及人工处理展示。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { PurchaseHistory } from "@/components/membership/purchase-history"
import { catalog } from "./membership-fixtures"
const mocks = vi.hoisted(() => ({ orders: vi.fn() }))
vi.mock("@/lib/api", () => ({ homeApi: { membership: { orders: mocks.orders } } }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const row = {
  orderNo: "PC12345678901234567890",
  tier: catalog.tiers[1],
  purpose: "upgrade",
  months: 3,
  payableFen: "4000",
  paidFen: null,
  payType: "alipay",
  status: "needs_review",
  createdAt: "2026-10-01T00:00:00Z",
  activatedAt: null,
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["me"], { id: "a" })
  const view = render(
    <QueryClientProvider client={client}>
      <PurchaseHistory ownerId="a" session={0} />
    </QueryClientProvider>,
  )
  return { client, ...view }
}
it("history loads only after expand", async () => {
  mocks.orders.mockResolvedValue({
    items: [row, { ...row, orderNo: "second", purpose: "renew" }],
    nextCursor: null,
  })
  mount()
  expect(mocks.orders).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "购买记录" }))
  expect(await screen.findByText("SVIP 3 个月 · 升级")).toBeTruthy()
  expect(screen.getAllByRole("listitem")).toHaveLength(2)
})
it("load more appends next page", async () => {
  mocks.orders.mockResolvedValueOnce({ items: [row], nextCursor: "next" }).mockResolvedValueOnce({
    items: [{ ...row, orderNo: "second", purpose: "renew" }],
    nextCursor: null,
  })
  mount()
  fireEvent.click(screen.getByRole("button", { name: "购买记录" }))
  fireEvent.click(await screen.findByRole("button", { name: "加载更多" }))
  expect(await screen.findByText("SVIP 3 个月 · 续费")).toBeTruthy()
  expect(screen.getAllByRole("listitem")).toHaveLength(2)
  expect(mocks.orders).toHaveBeenLastCalledWith({ cursor: "next", limit: 10 })
})
it("needs review row shows handling label", async () => {
  mocks.orders.mockResolvedValue({ items: [row], nextCursor: null })
  mount()
  fireEvent.click(screen.getByRole("button", { name: "购买记录" }))
  expect(await screen.findByText("人工处理中")).toBeTruthy()
  expect(screen.getByRole("button", { name: "复制单号" })).toBeTruthy()
})

it("rejects a late history response after the current owner changes", async () => {
  let resolve!: (value: unknown) => void
  mocks.orders.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const { client } = mount()
  fireEvent.click(screen.getByRole("button", { name: "购买记录" }))
  await act(async () => {
    client.setQueryData(["me"], { id: "b" })
    resolve({ items: [row], nextCursor: null })
  })
  expect(screen.queryByText("SVIP 3 个月 · 升级")).toBeNull()
  expect(client.getQueryData(["membership-orders", "a", 0])).toBeUndefined()
})
