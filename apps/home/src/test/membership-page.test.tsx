// 负责验证会员页的服务端价格、升级报价、账户隔离与支付回跳。
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import MembershipPage from "@/app/(app)/membership/page"
import { formatTime } from "@pigclaude/web-ui/lib/format"
import { catalog, quotes, created, homeOrder } from "./membership-fixtures"
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  quotes: vi.fn(),
  me: vi.fn(),
  order: vi.fn(),
  createOrder: vi.fn(),
  params: "",
  path: "/membership",
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.params),
  usePathname: () => mocks.path,
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    user: { me: mocks.me },
    membership: {
      entitlement: async () => quotes.entitlement,
      catalog: mocks.catalog,
      quotes: mocks.quotes,
      order: mocks.order,
      createOrder: mocks.createOrder,
    },
  },
}))
beforeEach(() => {
  mocks.createOrder.mockResolvedValue(created)
  mocks.params = ""
  mocks.path = "/membership"
  mocks.me.mockResolvedValue({ id: "a" })
  mocks.catalog.mockResolvedValue(catalog)
  mocks.quotes.mockResolvedValue(quotes)
  mocks.order.mockResolvedValue({ ...homeOrder, status: "pending" })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <MembershipPage />
    </QueryClientProvider>,
  )
  return { client, ...view }
}
it("renders cards durations benefits and checkout", async () => {
  const { container } = mount()
  await screen.findByRole("radiogroup", { name: "会员等级" })
  expect(screen.getByRole("button", { name: "立即续费" })).toBeTruthy()
  expect(container.querySelector("select")).toBeNull()
})
it("account loading exposes named skeleton without visible loading text", async () => {
  mocks.me.mockReturnValue(new Promise(() => {}))
  const { container } = mount()
  const status = await screen.findByRole("status")
  expect(status.getAttribute("aria-label")).toBe("正在读取账户…")
  expect(status.textContent).toBe("")
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
})
it("loading shows skeleton not text", async () => {
  mocks.quotes.mockReturnValue(new Promise(() => {}))
  mount()
  await waitFor(() => expect(mocks.quotes).toHaveBeenCalled())
  expect(screen.queryByText(/正在读取会员信息/)).toBeNull()
})
it("renders server prices and upgrade credit without original prices", async () => {
  mount()
  await screen.findByText("¥8.33/月")
  expect(screen.queryByText(/原价/)).toBeNull()
  fireEvent.click(screen.getByRole("radio", { name: /SVIP/ }))
  expect(screen.getByText("已抵扣 ¥10.00")).toBeTruthy()
  expect(screen.getByText("另赠 2 天 0 小时")).toBeTruthy()
  expect(screen.getByRole("button", { name: "立即升级" })).toBeTruthy()
})
it("lower tier card disabled for svip", async () => {
  mocks.quotes.mockResolvedValue({
    ...quotes,
    entitlement: { ...quotes.entitlement, tier: catalog.tiers[1] },
    offers: [{ ...quotes.offers[0], blocked: "LOWER_TIER" }],
    remainingUpgrade: null,
  })
  mount()
  const card = await screen.findByRole("radio", { name: /你已是 SVIP，无需购买 VIP/ })
  expect((card as HTMLButtonElement).disabled).toBe(true)
})
it("remaining upgrade card only on selected tier and when offered", async () => {
  const view = mount()
  await screen.findByText("¥8.33/月")
  expect(screen.queryByRole("button", { name: /把剩余/ })).toBeNull()
  fireEvent.click(screen.getByRole("radio", { name: /SVIP/ }))
  expect(
    screen.getByRole("button", { name: /把剩余 10 天 0 小时升级为 SVIP，补 ¥10.00/ }),
  ).toBeTruthy()
  view.unmount()
  mocks.quotes.mockResolvedValue({ ...quotes, remainingUpgrade: null })
  mount()
  await screen.findByText("¥8.33/月")
  fireEvent.click(screen.getByRole("radio", { name: /SVIP/ }))
  expect(screen.queryByRole("button", { name: /把剩余/ })).toBeNull()
})
it("opens polling dialog when valid order query param present", async () => {
  mocks.params = `order=${created.orderNo}`
  mount()
  expect(await screen.findByRole("dialog")).toBeTruthy()
  await waitFor(() => expect(mocks.order).toHaveBeenCalledWith(created.orderNo))
})
it("ignores invalid return order", async () => {
  mocks.params = "order=bad"
  mount()
  await screen.findByText("¥8.33/月")
  expect(screen.queryByRole("dialog")).toBeNull()
})
it("separates public catalog from account quotes and closes on account change", async () => {
  const { client } = mount()
  fireEvent.click(await screen.findByRole("button", { name: "立即续费" }))
  expect(screen.getByRole("dialog")).toBeTruthy()
  mocks.quotes.mockImplementation(() => new Promise(() => {}))
  await act(async () => {
    client.setQueryData(["me"], { id: "b" })
  })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(screen.queryByText("¥8.33/月")).toBeNull()
  expect(client.getQueryData(["membership-catalog"])).toEqual(catalog)
})
it("does not expose late account A quotes after switching to B", async () => {
  let resolve!: (value: unknown) => void
  mocks.quotes
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    .mockResolvedValue({
      ...quotes,
      offers: [],
      remainingUpgrade: null,
      entitlement: {
        ...quotes.entitlement,
        tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
      },
    })
  const { client } = mount()
  await waitFor(() => expect(mocks.quotes).toHaveBeenCalledTimes(1))
  await act(async () => {
    client.setQueryData(["me"], { id: "b" })
  })
  await screen.findByText("会员有效 · SVIP")
  await act(async () => {
    resolve(quotes)
  })
  expect(screen.queryByText("会员有效 · VIP")).toBeNull()
  expect(screen.queryByRole("button", { name: "立即续费" })).toBeNull()
})
it("cancels the old dialog on route change even when returning to the same route", async () => {
  const { client, rerender } = mount()
  fireEvent.click(await screen.findByRole("button", { name: "立即续费" }))
  mocks.path = "/other"
  rerender(
    <QueryClientProvider client={client}>
      <MembershipPage />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole("dialog")).toBeNull()
  mocks.path = "/membership"
  rerender(
    <QueryClientProvider client={client}>
      <MembershipPage />
    </QueryClientProvider>,
  )
  expect(screen.queryByRole("dialog")).toBeNull()
})
it("cancels a late A quote across an A-B-A account cycle", async () => {
  let resolve!: (value: unknown) => void
  mocks.quotes
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    .mockResolvedValue({ ...quotes, offers: [], remainingUpgrade: null })
  const { client } = mount()
  await waitFor(() => expect(mocks.quotes).toHaveBeenCalledTimes(1))
  await act(async () => {
    client.setQueryData(["me"], { id: "b" })
  })
  await screen.findByText("会员有效 · VIP")
  await act(async () => {
    client.setQueryData(["me"], { id: "a" })
  })
  await act(async () => {
    resolve(quotes)
  })
  await screen.findByText("会员有效 · VIP")
  expect(screen.queryByRole("button", { name: "立即续费" })).toBeNull()
  expect(mocks.quotes).toHaveBeenCalledTimes(3)
})
it("does not reopen the return order after changing account", async () => {
  mocks.params = `order=${created.orderNo}`
  const { client } = mount()
  await screen.findByRole("dialog")
  await act(async () => {
    client.setQueryData(["me"], { id: "b" })
  })
  await screen.findByText("¥8.33/月")
  expect(screen.queryByRole("dialog")).toBeNull()
  await act(async () => {
    client.setQueryData(["me"], { id: "a" })
  })
  await screen.findByText("¥8.33/月")
  expect(screen.queryByRole("dialog")).toBeNull()
})

it("formats entitlement expiry for readers instead of raw ISO", async () => {
  mount()
  await screen.findByText(`有效期至 ${formatTime("2026-12-01T00:00:00Z")}`)
  expect(screen.queryByText(/2026-12-01T00:00:00Z/)).toBeNull()
})

it("page wires automatic checkout with the selected channel", async () => {
  mount()
  fireEvent.click(await screen.findByRole("radio", { name: /SVIP/ }))
  fireEvent.click(screen.getByRole("radio", { name: "微信" }))
  fireEvent.click(screen.getByRole("button", { name: "立即升级" }))
  await waitFor(() =>
    expect(mocks.createOrder).toHaveBeenCalledWith(
      { optionId: "svip-3", payType: "wxpay" },
      expect.any(Function),
    ),
  )
  expect(screen.queryByRole("button", { name: "创建订单" })).toBeNull()
})
it("page wires free quote to confirmation before a POST", async () => {
  mocks.quotes.mockResolvedValue({
    ...quotes,
    offers: quotes.offers.map((offer) => ({ ...offer, payableFen: "0" })),
  })
  mount()
  fireEvent.click(await screen.findByRole("radio", { name: /SVIP/ }))
  fireEvent.click(screen.getByRole("button", { name: "免费升级" }))
  expect(await screen.findByText("本次升级无需付款")).toBeTruthy()
  expect(mocks.createOrder).not.toHaveBeenCalled()
})

it("success closes with a toast and replays the current card glint", async () => {
  vi.useFakeTimers()
  mocks.createOrder.mockResolvedValue({ ...created, payment: { kind: "free" } })
  mount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
  const firstCard = screen.getByRole("radio", { name: /VIP.*基础权益/ })
  fireEvent.click(screen.getByRole("button", { name: "立即续费" }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500)
  })
  expect(screen.queryByRole("dialog")).toBeNull()
  expect(screen.getByRole("radio", { name: /VIP.*基础权益/ })).not.toBe(firstCard)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
  expect(screen.getByText("VIP 已生效")).toBeTruthy()
  vi.useRealTimers()
})
