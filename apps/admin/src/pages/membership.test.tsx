// 负责验证会员列表的分页、授权 mutation、query invalidation 和失败反馈。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MembersSection } from "@/components/membership/members-section"

const api = vi.hoisted(() => ({
  list: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/lib/api", () => ({
  adminApi: { membership: { list: api.list, grant: api.grant, revoke: api.revoke } },
}))
vi.mock("sonner", () => ({ toast }))

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MembersSection />
    </QueryClientProvider>,
  )
}

describe("MembersSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.list.mockResolvedValue({
      items: [
        {
          userId: "u1",
          planId: "p1",
          productCode: "pigclaude",
          planKind: "week",
          status: "active",
          lifetime: false,
          validUntil: "2026-10-20T00:00:00Z",
          termsVersion: "v1",
          termsAcceptedAt: null,
          entitlementVersion: "2",
        },
      ],
      nextCursor: "0",
    })
    api.grant.mockResolvedValue({
      userId: "u2",
      planId: "p1",
      productCode: "pigclaude",
      planKind: "week",
      status: "active",
      lifetime: false,
      validUntil: null,
      termsVersion: "v1",
      termsAcceptedAt: null,
      entitlementVersion: "1",
    })
  })

  it("renders server membership data and sends grant input through the API facade", async () => {
    renderSection()
    expect(await screen.findByText("u1")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "人工授予" }))
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "u2" } })
    fireEvent.change(screen.getByLabelText("套餐 ID"), { target: { value: "p1" } })
    fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "manual" } })
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    await waitFor(() =>
      expect(api.grant).toHaveBeenCalledWith({
        userId: "u2",
        planId: "p1",
        termsVersion: "v1",
        remark: "manual",
      }),
    )
  })

  it("reports a failed grant and does not show a success toast", async () => {
    api.grant.mockRejectedValueOnce(new Error("denied"))
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "人工授予" }))
    fireEvent.change(screen.getByLabelText("用户 ID"), { target: { value: "u2" } })
    fireEvent.change(screen.getByLabelText("套餐 ID"), { target: { value: "p1" } })
    fireEvent.change(screen.getByLabelText("操作备注"), { target: { value: "manual" } })
    fireEvent.click(screen.getByRole("button", { name: "确认授予" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("denied"))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
