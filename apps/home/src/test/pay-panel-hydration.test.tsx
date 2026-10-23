// 验证付款面板在移动端首次 hydration 后选择底部抽屉，并冻结后续容器类型。
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { act, cleanup, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { PayType } from "@pigclaude/api/membership/types"
import { PayPanel, type PaySummary } from "@/components/membership/pay-panel"

const mocks = vi.hoisted(() => ({ createOrder: vi.fn(), order: vi.fn(), entitlement: vi.fn() }))
vi.mock("@/lib/api", () => ({ homeApi: { membership: mocks } }))

const summary: PaySummary = {
  tierName: "旧报价",
  cardStyle: "azure",
  title: "旧套餐",
  optionPriceFen: "5000",
  creditFen: "1000",
  payableFen: "4000",
  bonusSeconds: "0",
}

beforeEach(() => {
  mocks.createOrder.mockResolvedValue({
    orderNo: "PC12345678901234567890",
    status: "pending",
    payableFen: "4000",
    expiresAt: "2027-01-01T00:00:00Z",
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it("hydrates a narrow viewport into a bottom sheet before freezing the container", async () => {
  let matches = false
  const listeners = new Set<() => void>()
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return matches
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(["me"], { id: "a" })
  const props = {
    ownerId: "a",
    intent: { optionId: "svip-3" } as const,
    payType: "wxpay" as const,
    payTypes: ["alipay", "wxpay"] as PayType[],
    summary,
    onClose: vi.fn(),
    onActivated: vi.fn(),
  }
  const tree = () => (
    <QueryClientProvider client={client}>
      <PayPanel {...props} />
    </QueryClientProvider>
  )
  const container = document.createElement("div")
  container.innerHTML = renderToString(tree())
  document.body.appendChild(container)
  matches = true
  hydrateRoot(container, tree())
  await act(async () => {
    for (const listener of listeners) listener()
  })
  await waitFor(() => {
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeTruthy()
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })
})
