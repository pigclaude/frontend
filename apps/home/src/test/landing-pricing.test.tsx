// 验证公开价格区等级选择、服务端金额及登录导航，不触发购买请求。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { homeSessionGeneration } from "@/lib/session-generation"
import { Pricing } from "@/components/landing/pricing"
const mocks = vi.hoisted(() => ({ catalog: vi.fn(), me: vi.fn(), push: vi.fn() }))
vi.mock("@/lib/api", () => ({
  homeApi: { membership: { catalog: mocks.catalog }, user: { me: mocks.me } },
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }))
const option = {
  id: "svip-3",
  months: 3,
  priceFen: "9007199254740993",
  monthlyPurchaseFen: "9999999999999999",
  perMonthFen: "1234",
  savedFen: "0",
  badge: "推荐",
  recommended: true,
}
const tier = {
  code: "svip",
  name: "SVIP",
  level: 2,
  cardStyle: "gold",
  tagline: "超级会员",
  benefits: ["高级权益"],
  monthlyPriceFen: "1234",
  options: [option],
}
beforeEach(() => {
  mocks.me.mockResolvedValue({ id: "user" })
  mocks.catalog.mockResolvedValue({
    tiers: [{ ...tier, code: "vip", name: "VIP", options: [], benefits: ["基础权益"] }, tier],
    payTypes: ["alipay"],
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <Pricing />
    </QueryClientProvider>,
  )
  return { ...view, client }
}
async function choose() {
  fireEvent.click(await screen.findByRole("radio", { name: /SVIP/ }))
  fireEvent.click(screen.getByRole("button", { name: /3 个月/ }))
}
it("logged out duration click goes to login with redirect", async () => {
  mocks.me.mockRejectedValue(new ApiError(401, { code: "UNAUTHORIZED", message: "未登录" }))
  show()
  await choose()
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      "/login?redirect=%2Fmembership%3Ftier%3Dsvip%26option%3Dsvip-3",
    ),
  )
})
it("logged in duration click goes to membership with params", async () => {
  show()
  await choose()
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith("/membership?tier=svip&option=svip-3"),
  )
  expect(screen.getByText("¥90,071,992,547,409.93")).toBeTruthy()
  expect(within(screen.getByLabelText("购买时长")).getByText("¥12.34/月")).toBeTruthy()
  expect(screen.getByText("高级权益")).toBeTruthy()
  expect(screen.queryByText("基础权益")).toBeNull()
  expect(screen.queryByText(/省/)).toBeNull()
  expect(screen.getByText("1 个月按 30 天计")).toBeTruthy()
})
it("keeps session errors from being treated as logged out", async () => {
  mocks.me.mockRejectedValue(new Error("会话服务异常"))
  show()
  await choose()
  expect(await screen.findByText(/会话服务异常/)).toBeTruthy()
  expect(mocks.push).not.toHaveBeenCalled()
})
it("preserves empty catalog and retry state", async () => {
  mocks.catalog
    .mockRejectedValueOnce(new Error("目录失败"))
    .mockResolvedValue({ tiers: [], payTypes: [] })
  show()
  fireEvent.click(await screen.findByRole("button", { name: /重试/ }))
  expect(await screen.findByText("暂无可用套餐")).toBeTruthy()
})
it("supports keyboard tier switching and exact server savings", async () => {
  mocks.catalog.mockResolvedValue({
    tiers: [
      { ...tier, code: "vip", name: "VIP", options: [] },
      { ...tier, options: [{ ...option, savedFen: "456" }] },
    ],
    payTypes: [],
  })
  show()
  const first = await screen.findByRole("radio", { name: /^VIP/ })
  fireEvent.keyDown(first, { key: "ArrowRight" })
  expect(screen.getByRole("radio", { name: /SVIP/ }).getAttribute("aria-checked")).toBe("true")
  expect(screen.getByText("省 ¥4.56")).toBeTruthy()
})

it("retries a server session failure with a fresh check and never caches identity", async () => {
  mocks.me
    .mockRejectedValueOnce(new ApiError(503, { message: "会话暂不可用" }))
    .mockResolvedValue({ id: "fresh-user" })
  const { client } = show()
  await choose()
  expect(await screen.findByText("会话暂不可用")).toBeTruthy()
  expect(mocks.push).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "重试" }))
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith("/membership?tier=svip&option=svip-3"),
  )
  expect(mocks.me).toHaveBeenCalledTimes(2)
  expect(client.getQueryData(["me"])).toBeUndefined()
})
it.each(["unmount", "logout"])("ignores a late successful session after %s", async (boundary) => {
  let finish: (() => void) | undefined
  mocks.me.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ id: "old" })
      }),
  )
  const view = show()
  await choose()
  expect(mocks.me).toHaveBeenCalledOnce()
  if (boundary === "unmount") view.unmount()
  else homeSessionGeneration.invalidate()
  await act(async () => {
    finish?.()
  })
  expect(mocks.push).not.toHaveBeenCalled()
})
it.each([401, 503])("ignores late session error %s after logout", async (status) => {
  let finish: (() => void) | undefined
  mocks.me.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        finish = () => reject(new ApiError(status, { message: "旧请求失败" }))
      }),
  )
  show()
  await choose()
  homeSessionGeneration.invalidate()
  await act(async () => {
    finish?.()
  })
  expect(mocks.push).not.toHaveBeenCalled()
  expect(screen.queryByText("旧请求失败")).toBeNull()
})

it("lets only the newest click navigate and clear pending", async () => {
  const finishes: (() => void)[] = []
  mocks.me.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(() => resolve({ id: "fresh" }))
      }),
  )
  show()
  fireEvent.click(await screen.findByRole("radio", { name: /SVIP/ }))
  const duration = screen.getByRole("button", { name: /3 个月/ })
  act(() => {
    duration.click()
    duration.click()
  })
  expect(mocks.me).toHaveBeenCalledTimes(2)
  await act(async () => {
    finishes[0]()
  })
  expect(mocks.push).not.toHaveBeenCalled()
  expect(duration.hasAttribute("disabled")).toBe(true)
  await act(async () => {
    finishes[1]()
  })
  expect(mocks.push).toHaveBeenCalledOnce()
  expect(duration.hasAttribute("disabled")).toBe(false)
})

it("orders tiers by level and labels the card price per month", async () => {
  mocks.catalog.mockResolvedValue({
    tiers: [tier, { ...tier, code: "vip", name: "VIP", level: 1, monthlyPriceFen: "990" }],
    payTypes: ["alipay"],
  })
  show()
  const cards = await screen.findAllByRole("radio")
  expect(cards.map((card) => card.querySelector(".membership-card-name")?.textContent)).toEqual([
    "VIP",
    "SVIP",
  ])
  expect(cards[0].getAttribute("aria-checked")).toBe("true")
  expect(within(cards[0]).getByText("¥9.90/月")).toBeTruthy()
  expect(screen.queryByText(/按月购买/)).toBeNull()
})
