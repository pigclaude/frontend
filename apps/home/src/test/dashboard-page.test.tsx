// 负责验证账户概览仅呈现真实账户资料，不把兼容字段默认值当成钱包能力。
import { cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EntitlementResponse, MeResponse } from "@pigclaude/api/home/types"
import DashboardPage from "@/app/(app)/dashboard/page"

const mocks = vi.hoisted(() => ({ me: vi.fn(), entitlement: vi.fn() }))
vi.mock("@/lib/api", () => ({
  homeApi: { user: { me: mocks.me }, membership: { entitlement: mocks.entitlement } },
}))

const createdAt = new Date(2026, 9, 1, 12, 34).toISOString()
const user: MeResponse = {
  id: "100001",
  nickname: "",
  email: "private@example.com",
  avatar: "",
  balance: "0",
  createdAt,
  emailVerified: true,
  hasPassword: true,
  passwordChangedAt: null,
}
const membership: EntitlementResponse = {
  status: "none",
  tier: null,
  remainingSeconds: "0",
  validUntil: null,
  entitlementVersion: "0",
}

beforeEach(() => {
  mocks.me.mockResolvedValue(user)
  mocks.entitlement.mockResolvedValue(membership)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

describe("dashboard account facts", () => {
  it("shows authenticated account information without inventing a wallet from zero balance", async () => {
    renderDashboard()
    expect(await screen.findByText("p•••@example.com")).toBeTruthy()
    expect(screen.queryByText("账户余额")).toBeNull()
    expect(screen.queryByText("¥0.00")).toBeNull()
    expect(screen.getByText("登录状态")).toBeTruthy()
    expect(screen.getByText("已登录")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "PigClaude 用户" })).toBeTruthy()
    expect(screen.getByText("100001")).toBeTruthy()
    expect(screen.queryByText(user.email)).toBeNull()
  })

  it("does not render a tier row when the authoritative entitlement has no tier", async () => {
    renderDashboard()
    await screen.findByText("p•••@example.com")
    expect(screen.queryByText("会员等级")).toBeNull()
  })

  it("uses the real registration timestamp instead of a sample date", async () => {
    renderDashboard()
    const timestamp = await screen.findByText("2026-10-01 12:34")
    expect(timestamp.tagName).toBe("TIME")
    expect(timestamp.getAttribute("datetime")).toBe(createdAt)
    expect(screen.getByText("注册时间")).toBeTruthy()
  })

  it("renders the nonempty tier from authoritative entitlement", async () => {
    mocks.me.mockResolvedValue(user)
    mocks.entitlement.mockResolvedValue({
      ...membership,
      tier: { code: "vip", name: "VIP", level: 1, cardStyle: "azure" },
    })
    renderDashboard()
    expect((await screen.findAllByText("VIP")).length).toBeGreaterThan(0)
    expect(screen.getByText("会员等级")).toBeTruthy()
    expect(screen.queryByText("会员产品")).toBeNull()
  })
})

it("shows member card with renew action for active member", async () => {
  mocks.entitlement.mockResolvedValue({
    ...membership,
    status: "active",
    tier: { code: "vip", name: "VIP", level: 1, cardStyle: "azure" },
    remainingSeconds: "176400",
    validUntil: "2026-12-01T00:00:00Z",
  })
  renderDashboard()
  expect((await screen.findByRole("link", { name: "续费" })).getAttribute("href")).toBe(
    "/membership",
  )
  expect(screen.getByText("剩余 2 天 1 小时")).toBeTruthy()
  expect(
    screen
      .getByText(/有效期至/)
      .closest(".membership-card")
      ?.getAttribute("data-size"),
  ).toBe("sm")
})
it("shows open action for none", async () => {
  renderDashboard()
  expect((await screen.findByRole("link", { name: "开通会员" })).getAttribute("href")).toBe(
    "/membership",
  )
  expect(screen.getByText("未开通")).toBeTruthy()
})
it("shows management action for expired membership", async () => {
  mocks.entitlement.mockResolvedValue({
    ...membership,
    status: "expired",
    tier: { code: "vip", name: "VIP", level: 1, cardStyle: "azure" },
  })
  renderDashboard()
  expect((await screen.findByRole("link", { name: "管理会员" })).getAttribute("href")).toBe(
    "/membership",
  )
})
