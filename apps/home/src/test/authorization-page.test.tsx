// 负责验证设备授权 approve 成功后失效 flow 查询，避免 staleTime 复用旧 pending 状态。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AuthorizationPage from "@/app/(app)/authorize/[flowId]/page"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  approve: vi.fn(),
  entitlement: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ flowId: "flow-1" }),
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
  mocks.approve.mockResolvedValue({ deviceId: "device-secret-1234", bindingEpoch: "1" })
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
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["authorization", "flow-1"],
      refetchType: "none",
    })
  })
})
