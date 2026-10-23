// 验证付款面板自动建单、免费确认、严格模式、逆序响应与服务端明细。
import { createClient } from "@pigclaude/api/client"
import { createHomeMembershipApi } from "@pigclaude/api/membership/home"
import { StrictMode } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { PayPanel, type PaySummary } from "@/components/membership/pay-panel"
import { homeSessionGeneration } from "@/lib/session-generation"
import type { HomeOrder, OrderStatus, OrderPresentation } from "@pigclaude/api/membership/types"
import { created } from "./membership-fixtures"
const mocks = vi.hoisted(() => ({ createOrder: vi.fn(), order: vi.fn(), entitlement: vi.fn() }))
vi.mock("@/lib/api", () => ({ homeApi: { membership: mocks } }))
const summary: PaySummary = {
  tierName: "旧报价",
  cardStyle: "azure",
  title: "旧套餐",
  optionPriceFen: "5000",
  creditFen: "1000",
  payableFen: "4000",
  bonusSeconds: "0",
}
const presentation: OrderPresentation = {
  tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
  purpose: "upgrade",
  months: 3,
  durationSeconds: "7776000",
  optionPriceFen: "6000",
  creditFen: "1000",
  bonusSeconds: "86400",
}
function response(status: OrderStatus = "pending", name = "SVIP"): HomeOrder {
  return {
    orderNo: created.orderNo,
    status,
    payableFen: "5000",
    expiresAt: created.expiresAt,
    presentation: { ...presentation, tier: { ...presentation.tier, name } },
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  mocks.entitlement.mockResolvedValue({
    status: "active",
    tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
    validUntil: "2027-01-01T00:00:00Z",
    remainingSeconds: "86400",
    entitlementVersion: "3",
  })
  vi.useFakeTimers()
  mocks.createOrder.mockResolvedValue({ ...created, payableFen: "5000", presentation })
  mocks.order.mockResolvedValue(response())
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
function mount(options: { free?: boolean; returnOnly?: boolean; strict?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["me"], { id: "a" })
  const close = vi.fn()
  const activated = vi.fn()
  function panel() {
    return (
      <QueryClientProvider client={client}>
        <PayPanel
          ownerId="a"
          intent={options.returnOnly ? undefined : { optionId: "svip-3" }}
          payType="wxpay"
          payTypes={["alipay", "wxpay"]}
          summary={
            options.returnOnly ? undefined : { ...summary, payableFen: options.free ? "0" : "4000" }
          }
          orderNo={options.returnOnly ? created.orderNo : undefined}
          onClose={close}
          onActivated={activated}
        />
      </QueryClientProvider>
    )
  }
  const view = render(options.strict ? <StrictMode>{panel()}</StrictMode> : panel())
  return {
    client,
    close,
    activated,
    ...view,
    refresh: () => view.rerender(options.strict ? <StrictMode>{panel()}</StrictMode> : panel()),
  }
}
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
// 金额明细是 dt/dd 对，按标签读出对应的金额。
function detail(label: string) {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent
}
it("creates on open with chosen channel and replaces quote with actual server presentation", async () => {
  mount()
  await tick()
  expect(mocks.createOrder).toHaveBeenCalledWith(
    { optionId: "svip-3", payType: "wxpay" },
    expect.any(Function),
  )
  expect(detail("应付")).toBe("¥50.00")
  expect(detail("档位价")).toBe("¥60.00")
  expect(detail("剩余价值抵扣")).toBe("−¥10.00")
  expect(detail("另赠")).toBe("1 天 0 小时")
  expect(screen.queryByText("旧报价")).toBeNull()
})
it("switching channel creates a fresh order and keeps the new QR", async () => {
  mount()
  await tick()
  mocks.createOrder.mockResolvedValue({
    ...created,
    presentation,
    payment: { kind: "qr", qrcode: "NEW_QR", imageUrl: null },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: "支付宝" }))
  })
  expect(mocks.createOrder.mock.calls[1][0]).toEqual({ optionId: "svip-3", payType: "alipay" })
  expect(screen.getByText("请使用支付宝扫码支付")).toBeTruthy()
})
it("check now polls immediately and resets the 2 second cycle", async () => {
  mount()
  await tick()
  await tick(1000)
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "我已完成支付" }))
  })
  expect(mocks.order).toHaveBeenCalledTimes(1)
  await tick(1999)
  expect(mocks.order).toHaveBeenCalledTimes(1)
  await tick(1)
  expect(mocks.order).toHaveBeenCalledTimes(2)
})
it("free upgrade requires confirmation and obeys the actual returned payment carrier", async () => {
  mount({ free: true })
  await tick()
  expect(screen.getByText("本次升级无需付款")).toBeTruthy()
  expect(mocks.createOrder).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "确认升级" }))
  })
  expect(screen.getByLabelText("付款二维码")).toBeTruthy()
  expect(screen.queryByText("SVIP 已生效")).toBeNull()
})
it("countdown ticks every second without a live announcement", async () => {
  mocks.createOrder.mockResolvedValue({
    ...created,
    presentation,
    expiresAt: new Date(Date.now() + 892000).toISOString(),
  })
  mount()
  await tick()
  expect(screen.getByText("14:52 后过期").getAttribute("aria-live")).toBe("off")
  await tick(1000)
  expect(screen.getByText("14:51 后过期")).toBeTruthy()
})
it("mobile alipay https QR provides an app link only on alipay", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  mocks.createOrder.mockResolvedValue({
    ...created,
    presentation,
    payment: { kind: "qr", qrcode: "https://qr.alipay.com/x", imageUrl: null },
  })
  mount()
  await tick()
  expect(screen.queryByRole("link", { name: "打开支付宝" })).toBeNull()
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: "支付宝" }))
  })
  expect(screen.getByRole("link", { name: "打开支付宝" }).getAttribute("href")).toBe(
    "https://qr.alipay.com/x",
  )
  expect(document.querySelector('[data-slot="sheet-content"]')).toBeTruthy()
  vi.unstubAllGlobals()
})
it("StrictMode replay and same-intent renders deliver one usable charged order", async () => {
  const pending = deferred<typeof created>()
  mocks.createOrder.mockReturnValue(pending.promise)
  const view = mount({ strict: true })
  await tick()
  view.refresh()
  await tick()
  expect(mocks.createOrder).toHaveBeenCalledTimes(1)
  await act(async () => {
    pending.resolve(created)
  })
  await tick()
  expect(screen.getByLabelText("付款二维码")).toBeTruthy()
  view.refresh()
  await tick(1000)
  expect(mocks.createOrder).toHaveBeenCalledTimes(1)
})
it("late pending lookup cannot override check-now activation", async () => {
  const old = deferred<ReturnType<typeof response>>()
  mocks.order.mockReturnValueOnce(old.promise).mockResolvedValue(response("activated"))
  const view = mount()
  await tick()
  await tick(2000)
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "我已完成支付" }))
  })
  await act(async () => {
    old.resolve(response("pending", "旧单"))
  })
  expect(screen.getByText("SVIP 已生效")).toBeTruthy()
  await tick(2500)
  expect(view.activated).toHaveBeenCalledTimes(1)
})
it("channel replacement ignores old activated responses and old presentation", async () => {
  const old = deferred<ReturnType<typeof response>>()
  mocks.order.mockReturnValueOnce(old.promise)
  const view = mount()
  await tick()
  await tick(2000)
  await act(async () => {
    fireEvent.click(screen.getByRole("radio", { name: "支付宝" }))
  })
  await act(async () => {
    old.resolve(response("activated", "旧单"))
  })
  expect(screen.queryByText("旧单 已生效")).toBeNull()
  expect(screen.getByLabelText("付款二维码")).toBeTruthy()
  await tick(2500)
  expect(view.activated).not.toHaveBeenCalled()
})
it.each(["owner", "session", "close", "unmount"])(
  "refresh awaiting success rejects delivery after %s invalidation",
  async (kind) => {
    const pending = deferred<void>()
    const view = mount()
    await tick()
    vi.spyOn(view.client, "invalidateQueries").mockReturnValue(pending.promise)
    mocks.order.mockResolvedValue(response("activated"))
    await tick(2000)
    if (kind === "owner") view.client.setQueryData(["me"], { id: "b" })
    if (kind === "session") homeSessionGeneration.invalidate()
    if (kind === "close") fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    if (kind === "unmount") view.unmount()
    await act(async () => {
      pending.resolve()
    })
    await tick(3000)
    expect(view.activated).not.toHaveBeenCalled()
    expect(screen.queryByText("SVIP 已生效")).toBeNull()
  },
)
it("return-only StrictMode displays owned metadata without inventing QR or reconstruction", async () => {
  mocks.order.mockResolvedValue(response("expired", "已停售等级"))
  const view = mount({ returnOnly: true, strict: true })
  await tick()
  expect(screen.getByText("已停售等级 · 3 个月")).toBeTruthy()
  expect(detail("应付")).toBe("¥50.00")
  expect(screen.queryByLabelText("付款二维码")).toBeNull()
  expect(screen.queryByRole("radio", { name: "支付宝" })).toBeNull()
  expect(mocks.createOrder).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "返回选择" }))
  expect(view.close).toHaveBeenCalledTimes(1)
})
it("success awaits entitlement refresh then closes precisely once after 2.5 seconds", async () => {
  const view = mount()
  await tick()
  view.client.setQueryData(["entitlement"], { validUntil: "2027-01-01T00:00:00Z" })
  mocks.order.mockResolvedValue(response("activated"))
  await tick(2000)
  expect(screen.getByText("SVIP 已生效")).toBeTruthy()
  expect(screen.getByText(/有效期至/)).toBeTruthy()
  await tick(2499)
  expect(view.close).not.toHaveBeenCalled()
  await tick(1)
  expect(view.close).toHaveBeenCalledTimes(1)
  expect(view.activated).toHaveBeenCalledTimes(1)
})
it("missing QR carrier stays unavailable and pending copy handles rejection", async () => {
  mocks.createOrder.mockResolvedValue({
    ...created,
    presentation,
    payment: { kind: "qr", qrcode: "", imageUrl: null },
  })
  mount()
  await tick()
  expect(screen.getByText("付款码暂不可用，请稍后重新查询订单")).toBeTruthy()
  mocks.order.mockResolvedValue(response("needs_review"))
  await tick(2000)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制单号" }))
  })
  expect(screen.getByText("复制失败，请手动复制单号")).toBeTruthy()
})

it("latest check-now result supersedes activation while its refresh is still awaiting", async () => {
  const view = mount()
  await tick()
  const pending = deferred<void>()
  vi.spyOn(view.client, "invalidateQueries").mockReturnValue(pending.promise)
  mocks.order.mockResolvedValueOnce(response("activated")).mockResolvedValue(response("pending"))
  await tick(2000)
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "我已完成支付" }))
  })
  await act(async () => {
    pending.resolve()
  })
  expect(screen.queryByText("SVIP 已生效")).toBeNull()
  expect(screen.getByLabelText("付款二维码")).toBeTruthy()
})

it.each(["bootstrap", "post"])(
  "StrictMode %s pause creates exactly one real charged POST and delivers it",
  async (phase) => {
    const pending = deferred<Response>()
    const writes: string[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url) === "/v1/session")
        return phase === "bootstrap"
          ? pending.promise
          : new Response(JSON.stringify({ csrf: "test" }))
      if (init?.method === "POST") {
        writes.push(String(init.body))
        return phase === "post" ? pending.promise : new Response(JSON.stringify(created))
      }
      return new Response(JSON.stringify(response()))
    })
    const api = createHomeMembershipApi(
      createClient({ fetch: fetcher, generation: homeSessionGeneration.current }),
    )
    mocks.createOrder.mockImplementation(api.createOrder)
    const view = mount({ strict: true })
    await tick()
    view.refresh()
    await tick()
    expect(writes).toHaveLength(phase === "post" ? 1 : 0)
    await act(async () => {
      pending.resolve(
        new Response(JSON.stringify(phase === "bootstrap" ? { csrf: "test" } : created)),
      )
    })
    await tick()
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toEqual({ optionId: "svip-3", payType: "wxpay", csrf: "test" })
    expect(screen.getByLabelText("付款二维码")).toBeTruthy()
  },
)
it.each(["owner", "session", "close"])(
  "automatic create facade blocks POST when %s changes during bootstrap",
  async (boundary) => {
    const bootstrap = deferred<Response>()
    const fetcher = vi.fn<typeof fetch>(() => bootstrap.promise)
    const api = createHomeMembershipApi(
      createClient({ fetch: fetcher, generation: homeSessionGeneration.current }),
    )
    mocks.createOrder.mockImplementation(api.createOrder)
    const view = mount({ strict: true })
    await tick()
    if (boundary === "owner") view.client.setQueryData(["me"], { id: "b" })
    if (boundary === "session") homeSessionGeneration.invalidate()
    if (boundary === "close") fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    await act(async () => {
      bootstrap.resolve(new Response(JSON.stringify({ csrf: "old" })))
    })
    await tick()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText("付款二维码")).toBeNull()
  },
)

it("success actually refreshes entitlement when membership was opened without a cached entitlement query", async () => {
  const view = mount()
  await tick()
  expect(view.client.getQueryData(["entitlement"])).toBeUndefined()
  mocks.order.mockResolvedValue(response("activated"))
  await tick(2000)
  expect(mocks.entitlement).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/有效期至/)).toBeTruthy()
})
it("late entitlement refresh cannot populate cache or deliver success after owner changes", async () => {
  const pending = deferred<{ validUntil: string }>()
  mocks.entitlement.mockReturnValue(pending.promise)
  const view = mount()
  await tick()
  mocks.order.mockResolvedValue(response("activated"))
  await tick(2000)
  view.client.setQueryData(["me"], { id: "b" })
  await act(async () => {
    pending.resolve({ validUntil: "2027-01-01T00:00:00Z" })
  })
  await tick(3000)
  expect(view.client.getQueryData(["entitlement"])).toBeUndefined()
  expect(screen.queryByText("SVIP 已生效")).toBeNull()
  expect(view.activated).not.toHaveBeenCalled()
})

it("closing before automatic creation is dispatched never starts a charged order", async () => {
  const view = mount()
  fireEvent.click(screen.getByRole("button", { name: "关闭" }))
  await tick()
  expect(mocks.createOrder).not.toHaveBeenCalled()
  expect(view.close).toHaveBeenCalledTimes(1)
  expect(screen.queryByLabelText("付款二维码")).toBeNull()
})

it("success replaces an inactive pre-payment entitlement request instead of awaiting its stale snapshot", async () => {
  const view = mount()
  await tick()
  const old = deferred<{ validUntil: string }>()
  const obsolete = view.client
    .fetchQuery({ queryKey: ["entitlement"], queryFn: () => old.promise })
    .catch(() => undefined)
  mocks.order.mockResolvedValue(response("activated"))
  await tick(2000)
  expect(mocks.entitlement).toHaveBeenCalledTimes(1)
  expect(screen.getByText("SVIP 已生效")).toBeTruthy()
  await act(async () => {
    old.resolve({ validUntil: "2020-01-01T00:00:00Z" })
    await obsolete
  })
  expect(view.client.getQueryData(["entitlement"])).toMatchObject({
    validUntil: "2027-01-01T00:00:00Z",
  })
})

it("keeps the open container and its state when the width crosses the breakpoint", async () => {
  let narrow = false
  const listeners = new Set<() => void>()
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return narrow
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  mocks.order.mockResolvedValue(response("needs_review"))
  mount()
  await tick()
  await tick(2000)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "复制单号" }))
  })
  expect(screen.getByText("单号已复制")).toBeTruthy()
  await act(async () => {
    narrow = true
    for (const listener of listeners) listener()
  })
  expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
  expect(screen.getByText("单号已复制")).toBeTruthy()
  vi.unstubAllGlobals()
})
