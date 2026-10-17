// 负责验证设备列表分页、解绑请求和失败时不伪造成功反馈。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DevicesSection } from "@/components/membership/devices-section"

const api = vi.hoisted(() => ({ list: vi.fn(), unbind: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/api", () => ({ adminApi: { devices: { list: api.list, unbind: api.unbind } } }))
vi.mock("sonner", () => ({ toast }))

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DevicesSection />
    </QueryClientProvider>,
  )
}

describe("DevicesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.list.mockResolvedValue({
      items: [
        {
          userId: "u1",
          deviceId: "device-123456789",
          deviceEncryptionPublicKeyHash: "enc-hash-123456789",
          deviceSigningPublicKeyHash: "sig-hash-123456789",
          deviceFingerprintHash: "fp-hash-123456789",
          bindingEpoch: "7",
          lastSeenAt: null,
        },
      ],
      nextCursor: "0",
    })
  })

  it("requires a reason before sending unbind and uses the user id path payload", async () => {
    api.unbind.mockResolvedValue({})
    renderSection()
    expect(await screen.findByText("u1")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "解绑" }))
    fireEvent.change(screen.getByLabelText("解绑原因"), { target: { value: "rotation" } })
    fireEvent.click(screen.getByRole("button", { name: "确认解绑" }))
    await waitFor(() =>
      expect(api.unbind).toHaveBeenCalledWith({ userId: "u1", reason: "rotation" }),
    )
  })

  it("keeps the dialog open and reports failure when unbind is rejected", async () => {
    api.unbind.mockRejectedValueOnce(new Error("failed"))
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "解绑" }))
    fireEvent.change(screen.getByLabelText("解绑原因"), { target: { value: "rotation" } })
    fireEvent.click(screen.getByRole("button", { name: "确认解绑" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("failed"))
    expect(screen.getByRole("dialog", { name: "解绑设备" })).toBeTruthy()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
