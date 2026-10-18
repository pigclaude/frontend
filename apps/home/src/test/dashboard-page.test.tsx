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
  id: "user-private-account-1234",
  nickname: "",
  email: "private@example.com",
  avatar: "",
  balance: "0",
  createdAt,
  productCode: "",
  planKind: "",
  membershipStatus: "inactive",
  validUntil: null,
}
const membership: EntitlementResponse = {
  productCode: "",
  planKind: "day",
  status: "inactive",
  lifetime: false,
  validUntil: null,
  termsVersion: "",
  termsAcceptedAt: null,
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
    expect(screen.getByText("user••••1234")).toBeTruthy()
    expect(screen.queryByText(user.id)).toBeNull()
    expect(screen.queryByText(user.email)).toBeNull()
  })

  it("does not render a product row when the authoritative entitlement has no product", async () => {
    renderDashboard()
    await screen.findByText("p•••@example.com")
    expect(screen.queryByText("产品")).toBeNull()
  })

  it("uses the real registration timestamp instead of a sample date", async () => {
    renderDashboard()
    const timestamp = await screen.findByText("2026-10-01 12:34")
    expect(timestamp.tagName).toBe("TIME")
    expect(timestamp.getAttribute("datetime")).toBe(createdAt)
    expect(screen.getByText("注册时间")).toBeTruthy()
  })

  it("renders a nonempty product from entitlement instead of the compatibility user field", async () => {
    mocks.me.mockResolvedValue({ ...user, productCode: "legacy-product" })
    mocks.entitlement.mockResolvedValue({ ...membership, productCode: "pigclaude" })
    renderDashboard()
    expect(await screen.findByText("pigclaude")).toBeTruthy()
    expect(screen.getByText("产品")).toBeTruthy()
    expect(screen.queryByText("legacy-product")).toBeNull()
  })
})
