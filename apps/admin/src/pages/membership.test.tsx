// 负责验证会员列表的分页、授权 mutation、query invalidation 和失败反馈。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MembersSection } from "@/components/membership/members-section"

const api = vi.hoisted(() => ({
  list: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/lib/api", () => ({
  adminApi: {
    membership: {
      memberships: { list: api.list },
      grants: { create: api.grant },
      revoke: api.revoke,
    },
  },
}))
vi.mock("sonner", () => ({ toast }))

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateQueries = vi.spyOn(client, "invalidateQueries")
  return {
    client,
    invalidateQueries,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MembersSection />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

describe("MembersSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it("renders server membership data and sends grant input through the API facade", async () => {
    const { invalidateQueries } = renderSection()
    expect(await screen.findByText("u1")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "人工授予" }))
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "u2" } })
    fireEvent.change(screen.getByLabelText("等级 ID"), { target: { value: "p1" } })
    fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "manual" } })
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    await waitFor(() =>
      expect(api.grant).toHaveBeenCalledWith(
        {
          userId: "u2",
          tierId: "p1",
          durationUnit: "day",
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
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "u2" } })
    fireEvent.change(screen.getByLabelText("等级 ID"), { target: { value: "p1" } })
    fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "manual" } })
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("denied"))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
