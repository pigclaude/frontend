// 验证真实授予预览和用户摘要在固定 UTC 与上海时区下保持本地日期一致。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, expect, it, vi } from "vitest"
import { GrantDialog } from "./grant-dialog"
import { setupPickerDom } from "./grant-test-support"
const api = vi.hoisted(() => ({ preview: vi.fn(), list: vi.fn(), search: vi.fn() }))
vi.mock("@/lib/api", () => ({
  adminApi: {
    membership: { grants: api, tiers: { list: api.list }, users: { search: api.search } },
  },
}))
setupPickerDom()
afterEach(() => vi.restoreAllMocks())
it.each([
  ["UTC", "2027/1/3 16:57:06"],
  ["Asia/Shanghai", "2027/1/4 00:57:06"],
])("renders preview and picker using local time in %s", async (timeZone, expected) => {
  // 显式提供浏览器本地时区，仍调用真实 Intl 格式化，避免依赖开发机 TZ。
  const native = Date.prototype.toLocaleString
  vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
    this: Date,
    locales,
    options,
  ) {
    return native.call(this, locales, { ...options, timeZone })
  })
  api.list.mockResolvedValue({
    items: [
      {
        id: "vip",
        code: "vip",
        name: "VIP",
        level: 1,
        cardStyle: "azure",
        monthlyPriceFen: "100",
        tagline: "",
        benefits: [],
        enabled: true,
        options: [],
      },
    ],
  })
  api.search.mockResolvedValue({
    items: [
      {
        userId: "u1",
        email: "u@example.test",
        tier: { code: "vip", name: "VIP", level: 1, cardStyle: "azure" },
        validUntil: "2027-01-03T16:57:06Z",
        status: "active",
      },
    ],
  })
  api.preview.mockResolvedValue({
    tier: { name: "VIP", code: "vip", level: 1, cardStyle: "azure" },
    validUntil: "2027-01-03T16:57:06Z",
    voidedRemainingSeconds: "0",
    voidedValueFen: "0",
    convertedSeconds: "0",
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GrantDialog open onOpenChange={vi.fn()} onGranted={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByRole("combobox"), {
    target: { value: "u" },
  })
  const option = await screen.findByRole("option")
  expect.soft(option.textContent).toContain(`VIP · ${expected} 到期`)
  fireEvent.click(option)
  fireEvent.click(await screen.findByRole("radio", { name: /^VIP/ }))
  fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "manual" } })
  expect(await screen.findByText(`生效后：VIP，到期 ${expected}`)).toBeTruthy()
})
