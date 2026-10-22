// 负责验证会员列表的分页、授权 mutation、query invalidation 和失败反馈。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { setupPickerDom, fillGrant } from "@/components/membership/grant-test-support"
import MembershipPage from "./membership"
import { MembersSection } from "@/components/membership/members-section"

const api = vi.hoisted(() => ({
  list: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  search: vi.fn(),
  tiers: vi.fn(),
  preview: vi.fn(),
}))
const auth = vi.hoisted(() => ({ permissions: ["membership:read", "membership:write"] }))
vi.mock("@/hooks/use-admin-me", () => ({
  useAdminMe: () => ({ data: { id: "admin", status: "active", permissions: auth.permissions } }),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/lib/api", () => ({
  adminApi: {
    membership: {
      memberships: { list: api.list },
      grants: { create: api.grant, preview: api.preview },
      tiers: { list: api.tiers },
      users: { search: api.search },
      revoke: api.revoke,
    },
  },
}))
vi.mock("sonner", () => ({ toast }))

function renderSection(page = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateQueries = vi.spyOn(client, "invalidateQueries")
  return {
    client,
    invalidateQueries,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{page ? <MembershipPage /> : <MembersSection />}</MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

setupPickerDom()
describe("MembersSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.permissions = ["membership:read", "membership:write"]
    api.tiers.mockResolvedValue({ items: [{ id: "p1", name: "SVIP", enabled: false }] })
    api.search.mockResolvedValue({
      items: [
        {
          userId: "u2",
          email: "two@example.test",
          tierName: "VIP",
          status: "active",
          validUntil: "2026-12-01T00:00:00Z",
        },
      ],
    })
    api.preview.mockResolvedValue({
      tier: { code: "svip", name: "SVIP", level: 2 },
      validUntil: "2026-12-01T00:00:00Z",
      voidedRemainingSeconds: "864000",
      voidedValueFen: "1250",
      convertedSeconds: "172800",
    })
    api.list.mockResolvedValue({
      items: [
        {
          userId: "u1",
          status: "active",
          email: "member@example.test",
          tier: { code: "vip", name: "VIP", level: 1 },
          validUntil: "2026-10-20T00:00:00Z",
          entitlementVersion: "2",
        },
      ],
      nextCursor: null,
    })
    api.grant.mockResolvedValue({
      status: "active",
      remainingSeconds: "86400",
      tier: { code: "vip", name: "VIP", level: 1 },
      validUntil: "2026-10-30T00:00:00Z",
      entitlementVersion: "1",
    })
  })

  it("grant posts userId, tierId, duration, unit, valueFen and remark", async () => {
    const { invalidateQueries } = renderSection()
    expect(await screen.findByText("u1")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "人工授予" }))
    await fillGrant("manual")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(false),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    await waitFor(() =>
      expect(api.grant).toHaveBeenCalledWith(
        {
          userId: "u2",
          tierId: "p1",
          durationUnit: "month",
          duration: "1",
          valueFen: "0",
          remark: "manual",
        },
        expect.any(Function),
      ),
    )
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["admin-memberships"] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["admin-audits"] })
  })

  it("reports a failed grant and does not show a success toast", async () => {
    api.grant.mockRejectedValueOnce(new Error("denied"))
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "人工授予" }))
    await fillGrant("manual")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(false),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("denied"))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("grant preview shows conversion text", async () => {
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "人工授予" }))
    await fillGrant("manual")
    expect(await screen.findByText(/^生效后：SVIP，到期 /)).toBeTruthy()
    expect(
      screen.getByText("将清除 VIP 剩余 10 天 0 小时（价值 ¥12.50），折合 SVIP 2 天 0 小时"),
    ).toBeTruthy()
  })
  it("lower tier conflict disables submit", async () => {
    api.preview.mockRejectedValueOnce(new ApiError(409, { code: "LOWER_TIER_WHILE_HIGHER_ACTIVE" }))
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "人工授予" }))
    await fillGrant("manual")
    expect(await screen.findByText("该用户当前是更高等级，请先撤销")).toBeTruthy()
    expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(true)
    expect(api.grant).not.toHaveBeenCalled()
  })
  it("list shows email and tier and expired label", async () => {
    api.list.mockResolvedValueOnce({
      items: [
        {
          userId: "expired-id",
          email: "expired@example.test",
          tier: { code: "vip", name: "VIP", level: 1 },
          status: "expired",
          validUntil: "2020-01-01T00:00:00Z",
          entitlementVersion: "1",
        },
      ],
      nextCursor: null,
    })
    renderSection()
    expect(await screen.findByText("expired@example.test")).toBeTruthy()
    expect(screen.getByText("expired-id")).toBeTruthy()
    expect(screen.getAllByText("已过期").length).toBeGreaterThan(0)
    expect(screen.getByText("0 天 0 小时")).toBeTruthy()
  })
  it("parses large grant value exactly and switches duration unit", async () => {
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "人工授予" }))
    await fillGrant("manual")
    fireEvent.change(screen.getByLabelText("授予价值（元）"), {
      target: { value: "90071992547409.93" },
    })
    fireEvent.click(screen.getByRole("button", { name: "3 个月" }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: "时长单位" }), { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("option", { name: "天" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(false),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    expect(api.grant).toHaveBeenCalledWith(
      {
        userId: "u2",
        tierId: "p1",
        duration: "3",
        durationUnit: "day",
        valueFen: "9007199254740993",
        remark: "manual",
      },
      expect.any(Function),
    )
  })
  it("rejects excess value precision without preview or submit", async () => {
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "人工授予" }))
    await fillGrant("manual")
    fireEvent.change(screen.getByLabelText("授予价值（元）"), { target: { value: "1.001" } })
    expect(screen.getByRole("alert").textContent).toContain("不支持超出精度")
    expect(screen.getByRole("button", { name: "确认授予" }).hasAttribute("disabled")).toBe(true)
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.grant).not.toHaveBeenCalled()
  })
  it("passes email tier and status filters to the list", async () => {
    renderSection()
    await screen.findByText("member@example.test")
    fireEvent.change(screen.getByLabelText("会员用户筛选"), {
      target: { value: "member@example.test" },
    })
    fireEvent.click(screen.getByRole("button", { name: "筛选" }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: "会员等级" }), { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("option", { name: "SVIP" }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: "会员状态" }), { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("option", { name: "已过期" }))
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        q: "member@example.test",
        tierId: "p1",
        status: "expired",
        cursor: undefined,
        limit: 20,
      }),
    )
  })

  it("read-only membership page cannot grant or revoke", async () => {
    auth.permissions = ["membership:read"]
    renderSection(true)
    await screen.findByText("member@example.test")
    expect(screen.queryByRole("button", { name: "人工授予" })).toBeNull()
    expect(screen.getByRole("button", { name: "撤销" }).hasAttribute("disabled")).toBe(true)
    expect(api.preview).not.toHaveBeenCalled()
  })
  it("does not load membership data without read permission", () => {
    auth.permissions = ["membership:write"]
    renderSection(true)
    expect(screen.getByText("没有查看会员的权限")).toBeTruthy()
    expect(api.list).not.toHaveBeenCalled()
    expect(api.tiers).not.toHaveBeenCalled()
  })
})
