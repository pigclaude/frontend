// 验证授予卡片、时长切换和服务端时间线的可访问展示及输入边界。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import type { Tier } from "@pigclaude/api/membership/types"
import { GrantTimeline } from "./grant-timeline"
import { GrantDialog } from "./grant-dialog"
import { setupPickerDom } from "./grant-test-support"
const api = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
  preview: vi.fn(),
  create: vi.fn(),
}))
vi.mock("@/lib/api", () => ({ adminApi: { membership: { tiers: api, users: api, grants: api } } }))
const vip: Tier = {
  id: "vip",
  code: "vip",
  name: "VIP",
  level: 1,
  cardStyle: "azure",
  monthlyPriceFen: "100",
  tagline: "入门会员",
  benefits: [],
  enabled: true,
  options: [],
}
setupPickerDom()
beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue({
    items: [vip, { ...vip, id: "svip", code: "svip", name: "SVIP", level: 2, cardStyle: "gold" }],
  })
  api.search.mockResolvedValue({
    items: [
      {
        userId: "u1",
        email: "u@example.test",
        status: "active",
        tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
        validUntil: "2099-01-01T00:00:00Z",
      },
    ],
  })
  api.preview.mockResolvedValue({
    tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
    validUntil: "2099-02-01T00:00:00Z",
    voidedRemainingSeconds: "864000",
    voidedValueFen: "1340",
    convertedSeconds: "604800",
  })
})
function mount(canWrite = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GrantDialog open canWrite={canWrite} onOpenChange={vi.fn()} onGranted={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
async function selectUser() {
  fireEvent.click(screen.getByRole("button", { name: "选择用户" }))
  fireEvent.change(screen.getByRole("combobox", { name: "搜索用户邮箱或 ID" }), {
    target: { value: "u" },
  })
  fireEvent.click(await screen.findByRole("option"))
}
async function completeGrant() {
  await selectUser()
  fireEvent.click(await screen.findByRole("radio", { name: /^SVIP/ }))
  fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "manual" } })
}
it("higher current tier disables lower tier card and preserves selected user summary", async () => {
  mount()
  await selectUser()
  const lower = await screen.findByRole("radio", { name: /^VIP/ })
  expect(lower.getAttribute("aria-disabled")).toBe("true")
  expect(lower.hasAttribute("disabled")).toBe(true)
  expect(screen.getByText("已是更高等级，请先撤销")).toBeTruthy()
  expect(screen.getByText("u1")).toBeTruthy()
  expect(screen.getByText("u@example.test")).toBeTruthy()
  expect(document.querySelector('.tier-badge[data-style="gold"]')).toBeTruthy()
  expect(screen.getByText(/到期$/)).toBeTruthy()
  fireEvent.click(lower)
  fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "manual" } })
  expect(api.preview).not.toHaveBeenCalled()
})
it("expired higher tier permits a lower card and keyboard selection", async () => {
  api.search.mockResolvedValue({
    items: [
      {
        userId: "u1",
        email: "u@example.test",
        status: "expired",
        tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
        validUntil: "2020-01-01",
      },
    ],
  })
  mount()
  await selectUser()
  const lower = await screen.findByRole("radio", { name: /^VIP/ })
  expect(lower.hasAttribute("disabled")).toBe(false)
  lower.focus()
  fireEvent.keyDown(lower, { key: "ArrowRight" })
  expect(screen.getByRole("radio", { name: /^SVIP/ }).getAttribute("aria-checked")).toBe("true")
})
it("timeline shows voided and converted segments with server time proportions", async () => {
  mount()
  await completeGrant()
  const voided = await screen.findByText(/将清除/)
  expect(voided.textContent).toContain("¥13.40")
  expect(voided.textContent).toContain("SVIP 剩余 10 天")
  expect(screen.getByText(/^折算 7 天/)).toBeTruthy()
  const segments = document.querySelectorAll<HTMLElement>("[data-timeline-segment]")
  expect(segments.length).toBe(3)
  expect([...segments].every((segment) => Number(segment.style.flexGrow) >= 0)).toBe(true)
  expect(
    document.querySelector('[data-timeline-segment="granted"]')?.getAttribute("data-style"),
  ).toBe("gold")
})
it("timeline omits zero segments", async () => {
  api.preview.mockResolvedValue({
    tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
    validUntil: "2099-02-01",
    voidedRemainingSeconds: "0",
    voidedValueFen: "0",
    convertedSeconds: "0",
  })
  mount()
  await completeGrant()
  await screen.findByText(/^到期 /)
  expect(document.querySelector('[data-timeline-segment="voided"]')).toBeNull()
  expect(document.querySelector('[data-timeline-segment="converted"]')).toBeNull()
  expect(screen.queryByText(/将清除/)).toBeNull()
})
it("uses month and day toggle group and preserves shortcuts", async () => {
  mount()
  await completeGrant()
  fireEvent.click(screen.getByRole("radio", { name: "天" }))
  await waitFor(() =>
    expect(api.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ durationUnit: "day", duration: "1" }),
      expect.any(Function),
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "6 个月" }))
  expect(screen.getByRole("radio", { name: "月" }).getAttribute("aria-checked")).toBe("true")
  await waitFor(() =>
    expect(api.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ durationUnit: "month", duration: "6" }),
      expect.any(Function),
    ),
  )
})
it("read only grant does not load tiers preview or write", () => {
  mount(false)
  expect(api.list).not.toHaveBeenCalled()
  expect(api.preview).not.toHaveBeenCalled()
  expect(api.create).not.toHaveBeenCalled()
})

it("timeline widths reflect only server seconds and end time", () => {
  const { container } = render(
    <GrantTimeline
      now="2026-01-01T00:00:00Z"
      previousTier={{ code: "vip", name: "VIP", level: 1, cardStyle: "azure" }}
      preview={{
        tier: { code: "svip", name: "SVIP", level: 2, cardStyle: "gold" },
        validUntil: "2026-01-31T00:00:00Z",
        voidedRemainingSeconds: "864000",
        convertedSeconds: "604800",
        voidedValueFen: "9007199254740993",
      }}
    />,
  )
  const weights = [...container.querySelectorAll<HTMLElement>("[data-timeline-segment]")].map(
    (segment) => segment.style.flexGrow,
  )
  expect(weights).toEqual(["250000", "575000", "175000"])
  expect(screen.getByText(/将清除/).textContent).toContain("¥90,071,992,547,409.93")
})
