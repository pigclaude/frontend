// 负责验证会员页的服务端价格、升级报价、账户隔离与支付回跳。
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import MembershipPage from "@/app/(app)/membership/page"
import { formatTime } from "@pigclaude/web-ui/lib/format"
import { catalog, quotes, created } from "./membership-fixtures"
const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  quotes: vi.fn(),
  me: vi.fn(),
  order: vi.fn(),
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
    },
  },
}))
beforeEach(() => {
  mocks.params = ""
  mocks.path = "/membership"
  mocks.me.mockResolvedValue({ id: "a" })
  mocks.catalog.mockResolvedValue(catalog)
  mocks.quotes.mockResolvedValue(quotes)
  mocks.order.mockResolvedValue({ ...created, status: "pending" })
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
it("renders server prices without 原价 wording and upgrade credit and bonus days", async () => {
  mount()
  await screen.findByText("按月购买 ¥30.00 · 省 ¥5.00")
  expect(screen.queryByText(/原价/)).toBeNull()
  expect(screen.getByText("折合 ¥8.33/月")).toBeTruthy()
  expect(
    screen.getByRole("button", { name: /升级 · 抵扣 ¥10.00 · 应付 ¥40.00 · 另赠 2 天/ }),
  ).toBeTruthy()
  expect(screen.getByText("剩余 10 天 0 小时")).toBeTruthy()
})
it("lower tier option disabled for svip", async () => {
  mocks.quotes.mockResolvedValue({
    ...quotes,
    offers: [{ ...quotes.offers[0], blocked: "LOWER_TIER" }],
    remainingUpgrade: null,
  })
  mount()
  expect(
    ((await screen.findByRole("button", { name: "你已是更高等级会员" })) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
})
it("remaining upgrade card only when offered", async () => {
  const view = mount()
  expect(
    await screen.findByRole("button", { name: /把剩余 10 天 0 小时升级为 SVIP，补 ¥10.00/ }),
  ).toBeTruthy()
  view.unmount()
  mocks.quotes.mockResolvedValue({ ...quotes, remainingUpgrade: null })
  mount()
  await screen.findByText("折合 ¥8.33/月")
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
  await screen.findByText("折合 ¥8.33/月")
  expect(screen.queryByRole("dialog")).toBeNull()
})
it("separates public catalog from account quotes and closes on account change", async () => {
  const { client } = mount()
  fireEvent.click(await screen.findByRole("button", { name: "续费" }))
  expect(screen.getByRole("dialog")).toBeTruthy()
  mocks.quotes.mockImplementation(() => new Promise(() => {}))
  await act(async () => {
    client.setQueryData(["me"], { id: "b" })
  })
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(screen.queryByText("折合 ¥8.33/月")).toBeNull()
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
  expect(screen.queryByRole("button", { name: "续费" })).toBeNull()
})
it("cancels the old dialog on route change even when returning to the same route", async () => {
  const { client, rerender } = mount()
  fireEvent.click(await screen.findByRole("button", { name: "续费" }))
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
  expect(screen.queryByRole("button", { name: "续费" })).toBeNull()
  expect(mocks.quotes).toHaveBeenCalledTimes(3)
})
it("does not reopen the return order after changing account", async () => {
  mocks.params = `order=${created.orderNo}`
  const { client } = mount()
  await screen.findByRole("dialog")
  await act(async () => {
    client.setQueryData(["me"], { id: "b" })
  })
  await screen.findByText("折合 ¥8.33/月")
  expect(screen.queryByRole("dialog")).toBeNull()
  await act(async () => {
    client.setQueryData(["me"], { id: "a" })
  })
  await screen.findByText("折合 ¥8.33/月")
  expect(screen.queryByRole("dialog")).toBeNull()
})

it("formats entitlement expiry for readers instead of raw ISO", async () => {
  mount()
  await screen.findByText(`有效期至 ${formatTime("2026-12-01T00:00:00Z")}`)
  expect(screen.queryByText(/2026-12-01T00:00:00Z/)).toBeNull()
})
