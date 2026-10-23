// 负责验证真实共享支付弹窗的二维码、终态、计时器和迟到响应隔离。
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { PayDialog } from "@/components/membership/pay-dialog"
import type { PayType } from "@pigclaude/api/membership/types"
import { created } from "./membership-fixtures"
import { homeSessionGeneration } from "@/lib/session-generation"
const mocks = vi.hoisted(() => ({ createOrder: vi.fn(), order: vi.fn() }))
vi.mock("@/lib/api", () => ({ homeApi: { membership: mocks } }))
beforeEach(() => {
  vi.useFakeTimers()
  mocks.createOrder.mockResolvedValue(created)
  mocks.order.mockResolvedValue({ ...created, status: "pending" })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
function mount(
  orderNo?: string,
  payTypes: PayType[] = ["alipay", "wxpay"],
  initialPayType?: PayType,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["me"], { id: "a" })
  const close = vi.fn()
  const invalidate = vi.spyOn(client, "invalidateQueries")
  const view = render(
    <QueryClientProvider client={client}>
      <PayDialog
        ownerId="a"
        intent={{ optionId: "svip-3" }}
        payTypes={payTypes}
        initialPayType={initialPayType}
        orderNo={orderNo}
        onClose={close}
      />
    </QueryClientProvider>,
  )
  return { client, close, invalidate, ...view }
}
async function create() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "创建订单" }))
  })
}
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
it("renders qr and polls until activated then refreshes queries and closes after 3 seconds", async () => {
  const { invalidate, close } = mount()
  await create()
  expect(screen.getByText("应付 ¥40.00")).toBeTruthy()
  expect(screen.getByLabelText("付款二维码").tagName.toLowerCase()).toBe("svg")
  mocks.order.mockResolvedValue({ ...created, status: "activated" })
  await tick(2000)
  expect(screen.getByText("支付成功，会员已生效")).toBeTruthy()
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["entitlement"] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["membership-quotes", "a"] })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["membership-orders", "a"] })
  await tick(2999)
  expect(close).not.toHaveBeenCalled()
  await tick(1)
  expect(close).toHaveBeenCalledTimes(1)
  expect(mocks.order).toHaveBeenCalledTimes(1)
})
it("renders imageUrl-only as the gateway image", async () => {
  mocks.createOrder.mockResolvedValue({
    ...created,
    payment: { kind: "qr", qrcode: "", imageUrl: "https://pay.example/code.png" },
  })
  mount()
  await create()
  expect(screen.getByRole("img", { name: "付款二维码" }).getAttribute("src")).toBe(
    "https://pay.example/code.png",
  )
  expect(document.querySelector("svg[aria-label='付款二维码']")).toBeNull()
})
it.each([true, false])(
  "redirect payment handles window opening success=%s with a real link",
  async (opened) => {
    vi.spyOn(window, "open").mockReturnValue(opened ? window : null)
    mocks.createOrder.mockResolvedValue({
      ...created,
      payment: { kind: "redirect", url: "https://pay.example/checkout" },
    })
    mount()
    await create()
    expect(window.open).toHaveBeenCalled()
    expect(
      screen.getByText(
        opened ? "已在新窗口打开收银台" : "浏览器阻止了新窗口，请点击下方链接打开收银台",
      ),
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "打开收银台" }).getAttribute("href")).toBe(
      "https://pay.example/checkout",
    )
    if (!opened) expect(screen.queryByText("已在新窗口打开收银台")).toBeNull()
  },
)
it.each(["expired", "closed", "needs_review"])("stops at terminal %s", async (status) => {
  mount()
  await create()
  mocks.order.mockResolvedValue({ ...created, status })
  await tick(2000)
  expect(
    screen.getByText(
      status === "needs_review" ? "付款已收到，正在人工处理，请联系客服" : "订单已过期，请重新下单",
    ),
  ).toBeTruthy()
  await tick(10000)
  expect(mocks.order).toHaveBeenCalledTimes(1)
  if (status !== "needs_review") {
    fireEvent.click(screen.getByRole("button", { name: "重新下单" }))
    await create()
    expect(mocks.createOrder).toHaveBeenCalledTimes(2)
  }
})
it("free payment succeeds without polling", async () => {
  mocks.createOrder.mockResolvedValue({ ...created, payment: { kind: "free" } })
  mount()
  await create()
  expect(screen.getByText("支付成功，会员已生效")).toBeTruthy()
  await tick(5000)
  expect(mocks.order).not.toHaveBeenCalled()
})
it.each([
  ["PAYMENT_CHANNEL_UNAVAILABLE", "此支付渠道暂不可用，请换一种支付方式"],
  ["PAYMENT_UNAVAILABLE", "在线支付暂未开放"],
])("maps %s", async (code, message) => {
  mocks.createOrder.mockRejectedValue(new ApiError(503, { code }))
  mount()
  await create()
  expect(screen.getByRole("alert").textContent).toContain(message)
})
it("stops polling on close and ignores a late order result", async () => {
  let resolve!: (value: unknown) => void
  mocks.order.mockReturnValue(
    new Promise((done) => {
      resolve = done
    }),
  )
  const { invalidate } = mount()
  await create()
  await tick(2000)
  fireEvent.click(screen.getByRole("button", { name: "关闭" }))
  await act(async () => {
    resolve({ ...created, status: "activated" })
  })
  await tick(10000)
  expect(invalidate).not.toHaveBeenCalled()
  expect(mocks.order).toHaveBeenCalledTimes(1)
})
it("ignores a late create after close and reopening", async () => {
  let resolve!: (value: unknown) => void
  mocks.createOrder.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  const first = mount()
  await create()
  fireEvent.click(screen.getByRole("button", { name: "关闭" }))
  first.unmount()
  mount()
  await act(async () => {
    resolve(created)
  })
  expect(screen.queryByText("应付 ¥40.00")).toBeNull()
  await tick(6000)
  expect(mocks.order).not.toHaveBeenCalled()
})
it("cleans success timer on unmount", async () => {
  mocks.createOrder.mockResolvedValue({ ...created, payment: { kind: "free" } })
  const { unmount, close } = mount()
  await create()
  unmount()
  await tick(5000)
  expect(close).not.toHaveBeenCalled()
})
it("does not deliver an order to a changed account", async () => {
  const { client, invalidate } = mount()
  await create()
  client.setQueryData(["me"], { id: "b" })
  await tick(5000)
  expect(mocks.order).not.toHaveBeenCalled()
  expect(invalidate).not.toHaveBeenCalled()
})
it("resumes a return order immediately without creating another order", async () => {
  mount(created.orderNo)
  await tick(0)
  expect(mocks.order).toHaveBeenCalledWith(created.orderNo)
  expect(mocks.createOrder).not.toHaveBeenCalled()
  await tick(2000)
  expect(mocks.order).toHaveBeenCalledTimes(2)
})
it("uses the selected enabled channel without sending client prices", async () => {
  mount()
  fireEvent.click(screen.getByRole("radio", { name: "微信" }))
  await create()
  expect(mocks.createOrder).toHaveBeenCalledWith(
    { optionId: "svip-3", payType: "wxpay" },
    expect.any(Function),
  )
  expect(screen.getByText("请用微信扫码")).toBeTruthy()
})
it("retries status errors and stops after a final response", async () => {
  mocks.order.mockRejectedValueOnce(new Error("network"))
  mount()
  await create()
  await tick(2000)
  expect(screen.getByRole("alert").textContent).toBe("订单状态读取失败，正在重试")
  mocks.order.mockResolvedValue({ ...created, status: "needs_review" })
  await tick(2000)
  expect(screen.queryByRole("alert")).toBeNull()
  await tick(6000)
  expect(mocks.order).toHaveBeenCalledTimes(2)
})
it("rejects late create on account change before opening any popup", async () => {
  let resolve!: (value: unknown) => void
  mocks.createOrder.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  const open = vi.spyOn(window, "open").mockReturnValue(null)
  const { client } = mount()
  await create()
  client.setQueryData(["me"], { id: "b" })
  await act(async () => {
    resolve({ ...created, payment: { kind: "redirect", url: "https://pay.example/checkout" } })
  })
  expect(open).not.toHaveBeenCalled()
  expect(screen.queryByText("应付 ¥40.00")).toBeNull()
})

it("session invalidation stops polling and success close delivery", async () => {
  const first = mount()
  await create()
  homeSessionGeneration.invalidate()
  await tick(4000)
  expect(mocks.order).not.toHaveBeenCalled()
  first.unmount()
  mocks.createOrder.mockResolvedValue({ ...created, payment: { kind: "free" } })
  const second = mount()
  await create()
  homeSessionGeneration.invalidate()
  await tick(4000)
  expect(second.close).not.toHaveBeenCalled()
})

it("only offers catalog channels and refuses creation when none are enabled", async () => {
  const first = mount(undefined, ["wxpay"])
  expect(screen.queryByRole("radio", { name: "支付宝" })).toBeNull()
  expect(screen.getByText("使用微信支付")).toBeTruthy()
  first.unmount()
  mount(undefined, [])
  expect(screen.getByText("在线支付暂未开放")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "创建订单" })).toBeNull()
  expect(mocks.createOrder).not.toHaveBeenCalled()
})

it("preserves checkout initial channel and falls back if it is unavailable", async () => {
  const view = mount(undefined, ["alipay", "wxpay"], "wxpay")
  expect(screen.getByRole("radio", { name: "微信" }).getAttribute("aria-checked")).toBe("true")
  await create()
  expect(mocks.createOrder.mock.calls[0][0]).toEqual({ optionId: "svip-3", payType: "wxpay" })
  view.unmount()
  mount(undefined, ["alipay"], "wxpay")
  await create()
  expect(mocks.createOrder.mock.calls[1][0]).toEqual({ optionId: "svip-3", payType: "alipay" })
})
