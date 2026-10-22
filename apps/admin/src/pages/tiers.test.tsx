// 验证等级编辑的服务端价格、精确单位、权限及不可变身份合同。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import TiersPage from "./tiers"

const api = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), save: vi.fn(), remove: vi.fn() }))
const auth = vi.hoisted(() => ({ permissions: ["membership:read", "membership:tiers:write"] }))
vi.mock("@/lib/api", () => ({ adminApi: { membership: { tiers: api } } }))
vi.mock("@/hooks/use-admin-me", () => ({
  useAdminMe: () => ({ data: { id: "a", status: "active", permissions: auth.permissions } }),
}))
const tier = {
  id: "tier-original",
  code: "vip",
  name: "VIP",
  level: 1,
  monthlyPriceFen: "10000",
  description: "",
  enabled: true,
  options: [
    {
      id: "option-original",
      months: 3,
      discountKind: "percent",
      discountValue: "7500",
      enabled: true,
      priceFen: "22500",
      monthlyPurchaseFen: "30000",
      savedFen: "7500",
    },
  ],
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TiersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
async function edit() {
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "编辑 VIP" }))
  return screen.getByRole("dialog")
}
afterEach(() => vi.unstubAllGlobals())
describe("tiers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    vi.clearAllMocks()
    auth.permissions = ["membership:read", "membership:tiers:write"]
    api.list.mockResolvedValue({ items: [tier] })
    api.preview.mockResolvedValue({
      ...tier,
      id: "temporary",
      options: [
        { ...tier.options[0], id: "temporary-option", priceFen: "27000", savedFen: "1234" },
      ],
    })
    api.save.mockResolvedValue(tier)
  })
  it("shows server preview prices, not client math, and retains save identity", async () => {
    const dialog = await edit()
    fireEvent.change(screen.getByLabelText("月价（元）"), { target: { value: "101.09" } })
    expect(await within(dialog).findByText("现价 ¥270.00")).toBeTruthy()
    expect(within(dialog).getByText("省 ¥12.34")).toBeTruthy()
    expect(api.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "vip", monthlyPriceFen: "10109" }),
      expect.any(Function),
    )
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    expect(api.save.mock.calls[0][0]).toBe("tier-original")
    expect(api.save.mock.calls[0][1]).not.toHaveProperty("code")
    expect(api.save.mock.calls[0][1].options[0].id).toBe("option-original")
  })
  it("percent input 7.5 is sent as 7500", async () => {
    await edit()
    fireEvent.change(screen.getByLabelText("优惠值 1"), { target: { value: "7.5" } })
    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith(
        expect.objectContaining({ options: [expect.objectContaining({ discountValue: "7500" })] }),
        expect.any(Function),
      ),
    )
  })
  it("read-only without tiers write", async () => {
    auth.permissions = ["membership:read"]
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "查看 VIP" }))
    expect(screen.getByLabelText("名称").hasAttribute("disabled")).toBe(true)
    expect(screen.getByLabelText("优惠值 1").hasAttribute("disabled")).toBe(true)
    expect(screen.queryByRole("button", { name: "保存等级" })).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.save).not.toHaveBeenCalled()
    expect(api.remove).not.toHaveBeenCalled()
  })
  it("delete with live members shows guidance", async () => {
    api.remove.mockRejectedValue(new ApiError(409, { code: "INVALID_STATE" }))
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "删除 VIP" }))
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
    expect(await screen.findByText("还有有效会员，请改为下架")).toBeTruthy()
  })
  it("creates a tier with code and exact amount without floating point conversion", async () => {
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "新建等级" }))
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Silver" } })
    fireEvent.change(screen.getByLabelText("代号"), { target: { value: "silver" } })
    fireEvent.change(screen.getByLabelText("月价（元）"), {
      target: { value: "90071992547409.91" },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        "new",
        expect.objectContaining({ code: "silver", monthlyPriceFen: "9007199254740991" }),
        expect.any(Function),
      ),
    )
  })
  it("rejects invalid decimal input before preview or save", async () => {
    await edit()
    fireEvent.change(screen.getByLabelText("月价（元）"), { target: { value: "1.001" } })
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    expect(screen.getByRole("alert").textContent).toContain("精度")
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.save).not.toHaveBeenCalled()
  })
  it("does not fetch tiers without read permission", () => {
    auth.permissions = ["membership:tiers:write"]
    mount()
    expect(screen.getByText("没有查看会员等级的权限")).toBeTruthy()
    expect(api.list).not.toHaveBeenCalled()
  })
  it("does not turn unrelated delete conflicts into active-member guidance", async () => {
    api.remove.mockRejectedValue(new ApiError(409, { code: "OTHER", message: "请求冲突" }))
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "删除 VIP" }))
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
    expect(await screen.findByText("请求冲突")).toBeTruthy()
    expect(screen.queryByText("还有有效会员，请改为下架")).toBeNull()
  })
})
