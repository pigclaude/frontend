// 负责验证会员页的服务端价格、升级报价、账户隔离与支付回跳。
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { HomeSessionContext } from "@/components/home-session-context"
import MembershipPage from "@/app/(app)/membership/page"
import { formatTime } from "@pigclaude/web-ui/lib/format"
import { catalog, quotes, created, homeOrder } from "./membership-fixtures"
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  catalog: vi.fn(),
  quotes: vi.fn(),
  me: vi.fn(),
  order: vi.fn(),
  createOrder: vi.fn(),
  params: "",
  path: "/membership",
  replace: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mocks.params),
  usePathname: () => mocks.path,
  useRouter: () => ({ replace: mocks.replace }),
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    user: { me: mocks.me },
    membership: {
      recoveryTarget: mocks.resolve,
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
  vi.useRealTimers()
  vi.clearAllMocks()
})
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <HomeSessionContext.Provider value={{ completeLogout: async () => undefined }}>
        <MembershipPage />
      </HomeSessionContext.Provider>
    </QueryClientProvider>,
  )
  return { client, ...view }
}
// 当前等级卡写着「当前等级 · 剩余 N 天」，用卡面样式判断页面展示的是哪个账户的等级。
function currentCardStyle() {
  return screen
    .getByText(/^当前等级 · 剩余/)
    .closest(".membership-card")
    ?.getAttribute("data-style")
}
it("renders cards durations benefits and checkout", async () => {
  const { container } = mount()
  await screen.findByRole("radiogroup", { name: "会员等级" })
  expect(screen.getByRole("button", { name: "立即续费" })).toBeTruthy()
  expect(screen.queryByText(/已抵扣/)).toBeNull()
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
  expect(screen.queryByRole("button", { name: /只想升级剩余/ })).toBeNull()
  fireEvent.click(screen.getByRole("radio", { name: /SVIP/ }))
  expect(
    screen.getByRole("button", { name: /只想升级剩余的 10 天？\s*补 ¥10\.00\s*，到期日不变/ }),
  ).toBeTruthy()
  view.unmount()
  mocks.quotes.mockResolvedValue({ ...quotes, remainingUpgrade: null })
  mount()
  await screen.findByText("¥8.33/月")
  fireEvent.click(screen.getByRole("radio", { name: /SVIP/ }))
  expect(screen.queryByRole("button", { name: /只想升级剩余/ })).toBeNull()
})
it("opens polling dialog when valid order query param present", async () => {
  mocks.params = `order=${created.orderNo}`
  mount()
  expect(await screen.findByRole("dialog")).toBeTruthy()
  await waitFor(() => expect(mocks.order).toHaveBeenCalledWith(created.orderNo))
})
it("closing a return order removes it from the address bar", async () => {
  mocks.params = `order=${created.orderNo}`
  mount()
  await screen.findByRole("dialog")
  expect(mocks.replace).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "关闭" }))
  expect(mocks.replace).toHaveBeenCalledWith("/membership")
})
it("closing a return order keeps the other query parameters", async () => {
  mocks.params = `tier=svip&order=${created.orderNo}&option=svip-3`
  mount()
  await screen.findByRole("dialog")
  fireEvent.click(screen.getByRole("button", { name: "关闭" }))
  expect(mocks.replace).toHaveBeenCalledWith("/membership?tier=svip&option=svip-3")
})
it("closing a fresh checkout leaves the address bar alone", async () => {
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "立即续费" }))
  fireEvent.click(screen.getByRole("button", { name: "关闭" }))
  expect(mocks.replace).not.toHaveBeenCalled()
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
  await waitFor(() => expect(currentCardStyle()).toBe("gold"))
  await act(async () => {
    resolve(quotes)
  })
  expect(currentCardStyle()).toBe("gold")
  expect(screen.queryByRole("button", { name: "立即续费" })).toBeNull()
})
it("cancels the old dialog on route change even when returning to the same route", async () => {
  const { client, rerender } = mount()
  fireEvent.click(await screen.findByRole("button", { name: "立即续费" }))
  mocks.path = "/other"
  rerender(
    <QueryClientProvider client={client}>
      <HomeSessionContext.Provider value={{ completeLogout: async () => undefined }}>
        <MembershipPage />
      </HomeSessionContext.Provider>
    </QueryClientProvider>,
  )
  expect(screen.queryByRole("dialog")).toBeNull()
  mocks.path = "/membership"
  rerender(
    <QueryClientProvider client={client}>
      <HomeSessionContext.Provider value={{ completeLogout: async () => undefined }}>
        <MembershipPage />
      </HomeSessionContext.Provider>
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
  await waitFor(() => expect(currentCardStyle()).toBe("azure"))
  await act(async () => {
    client.setQueryData(["me"], { id: "a" })
  })
  await act(async () => {
    resolve(quotes)
  })
  await waitFor(() => expect(currentCardStyle()).toBe("azure"))
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
  await screen.findByText(`${formatTime("2026-12-01T00:00:00Z").slice(0, 10)} 到期`)
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
  const firstCard = screen.getByRole("radio", { name: /^VIP/ })
  expect(firstCard.getAttribute("data-glint")).toBe("false")
  fireEvent.click(screen.getByRole("button", { name: "立即续费" }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500)
  })
  expect(screen.queryByRole("dialog")).toBeNull()
  const replayed = screen.getByRole("radio", { name: /^VIP/ })
  expect(replayed).not.toBe(firstCard)
  expect(replayed.getAttribute("data-glint")).toBe("true")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
  expect(screen.getByText("VIP 已生效，有效期至 2026-12-01")).toBeTruthy()
})

it.each(["empty", "retired", "blocked", "no-offer"])(
  "hides duration and checkout when %s has no purchasable offer",
  async (kind) => {
    mocks.catalog.mockResolvedValue(kind === "empty" ? { ...catalog, tiers: [] } : catalog)
    mocks.quotes.mockResolvedValue({
      ...quotes,
      currentTier: kind === "retired" ? { ...catalog.tiers[1], enabled: false } : null,
      offers:
        kind === "blocked" || kind === "retired"
          ? quotes.offers.map((offer) => ({ ...offer, blocked: "LOWER_TIER" }))
          : [],
    })
    mount()
    await screen.findByRole("radiogroup", { name: "会员等级" })
    expect(screen.queryByRole("radiogroup", { name: "购买时长" })).toBeNull()
    expect(screen.queryByRole("region", { name: "结算" })).toBeNull()
    expect(screen.getByRole("button", { name: "购买记录" })).toBeTruthy()
  },
)
it("keeps payment-disabled explanation when real purchasable offers exist", async () => {
  mocks.catalog.mockResolvedValue({ ...catalog, payTypes: [] })
  mount()
  await screen.findByRole("radiogroup", { name: "购买时长" })
  expect(screen.getByRole("region", { name: "结算" }).textContent).toContain("在线支付暂未开放")
})
it("current card contains its own remaining time and expiry, including retired rights", async () => {
  mocks.catalog.mockResolvedValue({ ...catalog, tiers: [catalog.tiers[1]] })
  mocks.quotes.mockResolvedValue({
    ...quotes,
    currentTier: { ...catalog.tiers[0], enabled: false },
  })
  mount()
  const group = await screen.findByRole("radiogroup", { name: "会员等级" })
  const current = group.querySelector('[data-style="azure"]')
  expect(current?.textContent).toContain("剩余 10 天")
  expect(current?.textContent).toContain("2026-12-01 到期")
  expect(current?.textContent).toContain("该等级已停售，到期前权益不受影响")
})

it("does not mount checkout until the current website account matches the desktop target", async () => {
  mocks.params = "recoveryTarget=69f099b7-260a-4f61-a37e-3332c1380e53"
  mocks.resolve.mockResolvedValue({ state: "mismatch" })
  mount()
  await screen.findByRole("button", { name: "切换网站账号" })
  expect(mocks.quotes).not.toHaveBeenCalled()
  expect(mocks.createOrder).not.toHaveBeenCalled()
})
it("retains the verified target on checkout instead of creating an ordinary order", async () => {
  const target = "69f099b7-260a-4f61-a37e-3332c1380e53"
  mocks.params = `recoveryTarget=${target}`
  mocks.resolve.mockResolvedValue({ state: "matched", currentUserId: "a", action: "renew" })
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "立即续费" }))
  await waitFor(() =>
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ recoveryTarget: target }),
      expect.any(Function),
    ),
  )
})
it("preserves an open order while rechecking the same recovery target", async () => {
  const target = "69f099b7-260a-4f61-a37e-3332c1380e53"
  const proof = { state: "matched", currentUserId: "a", action: "renew" }
  mocks.params = `recoveryTarget=${target}`
  mocks.resolve.mockResolvedValue(proof)
  const { client } = mount()
  fireEvent.click(await screen.findByRole("button", { name: "立即续费" }))
  await waitFor(() => expect(mocks.createOrder).toHaveBeenCalledTimes(1))
  let release!: (value: typeof proof) => void
  mocks.resolve.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  let pending!: Promise<void>
  await act(async () => {
    pending = client.refetchQueries({ queryKey: ["membership-recovery"] })
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15))
  })
  expect(screen.queryByRole("dialog")).not.toBeNull()
  await act(async () => {
    release(proof)
    await pending
  })
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull())
  expect(mocks.createOrder).toHaveBeenCalledTimes(1)
})
