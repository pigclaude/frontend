// 负责验证设备授权 approve 成功后失效 flow 查询，避免 staleTime 复用旧 pending 状态。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AuthorizationPage from "@/app/(app)/authorize/[flowId]/page"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  approve: vi.fn(),
  entitlement: vi.fn(),
  searchParams: "state=flow-state",
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ flowId: "flow-1" }),
  useSearchParams: () => new URLSearchParams(mocks.searchParams),
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    authorizations: { get: mocks.get, approve: mocks.approve },
    membership: { entitlement: mocks.entitlement },
  },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.searchParams = "state=flow-state"
  mocks.get.mockResolvedValue({
    flowId: "flow-1",
    deviceId: "device-secret-1234",
    deviceFingerprintHash: "fingerprint-secret-5678",
    status: "pending",
    existingDeviceId: null,
    existingBindingEpoch: null,
    requiresReplace: false,
    expiresAt: null,
  })
  mocks.entitlement.mockResolvedValue({ status: "active" })
  mocks.approve.mockResolvedValue({
    deviceId: "device-secret-1234",
    bindingEpoch: "1",
    location: "http://127.0.0.1:43123/oauth/callback?code=one&state=flow-state",
  })
})

describe("AuthorizationPage approve cache", () => {
  it("invalidates the flow query after a successful approve", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries")
    render(
      <QueryClientProvider client={queryClient}>
        <AuthorizationPage />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "确认授权" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "确认授权" }))
    await waitFor(() => expect(screen.getByText("设备已授权")).toBeTruthy())
    expect(mocks.approve).toHaveBeenCalledWith("flow-1", {
      replaceExisting: false,
      state: "flow-state",
    })
    expect(screen.getByRole("link", { name: "返回桌面客户端" }).getAttribute("href")).toBe(
      "http://127.0.0.1:43123/oauth/callback?code=one&state=flow-state",
    )
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["authorization", "flow-1"],
      refetchType: "none",
    })
  })

  it("blocks approval when the authorization URL has no state", async () => {
    mocks.searchParams = ""
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AuthorizationPage />
      </QueryClientProvider>,
    )
    const approveButton = await screen.findByRole("button", { name: "确认授权" })
    expect((approveButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText("授权链接缺少安全状态")).toBeTruthy()
    expect(mocks.approve).not.toHaveBeenCalled()
  })
})
