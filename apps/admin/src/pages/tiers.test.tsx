// 验证等级编辑的服务端价格、精确单位、权限及不可变身份合同。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import TiersPage from "./tiers"

const api = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), save: vi.fn(), remove: vi.fn() }))
const auth = vi.hoisted(() => ({
  id: "a",
  permissions: ["membership:read", "membership:tiers:write"],
}))
vi.mock("@/lib/api", () => ({ adminApi: { membership: { tiers: api } } }))
vi.mock("@/hooks/use-admin-me", () => ({
  useAdminMe: () => ({ data: { id: auth.id, status: "active", permissions: auth.permissions } }),
}))
const tier = {
  id: "tier-original",
  code: "vip",
  name: "VIP",
  level: 1,
  monthlyPriceFen: "10000",
  tagline: "",
  cardStyle: "rose",
  benefits: ["保留权益"],
  enabled: true,
  activeMemberCount: 1,
  options: [
    {
      id: "option-original",
      months: 3,
      discountKind: "percent",
      discountValue: "7500",
      badge: "专属",
      recommended: true,
      enabled: true,
      priceFen: "22500",
      perMonthFen: "7500",
      monthlyPurchaseFen: "30000",
      savedFen: "7500",
    },
  ],
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TiersPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(tree())
  return { ...view, rerenderPage: () => view.rerender(tree()) }
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
    auth.id = "a"
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
    expect(within(dialog).getAllByText("省 ¥12.34")).toHaveLength(2)
    expect(api.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "vip", monthlyPriceFen: "10109" }),
      expect.any(Function),
    )
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    expect(api.save.mock.calls[0][0]).toBe("tier-original")
    expect(api.save.mock.calls[0][1]).not.toHaveProperty("code")
    expect(api.save.mock.calls[0][1].options[0].id).toBe("option-original")
    expect(api.save.mock.calls[0][1]).toMatchObject({
      cardStyle: "rose",
      benefits: ["保留权益"],
      options: [{ id: "option-original", badge: "专属", recommended: true }],
    })
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
    fireEvent.keyDown(await screen.findByRole("button", { name: "更多 VIP" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }))
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
    expect(await screen.findByText("还有有效会员，无法删除")).toBeTruthy()
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
    fireEvent.keyDown(await screen.findByRole("button", { name: "更多 VIP" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }))
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
    expect(await screen.findByText("请求冲突")).toBeTruthy()
    expect(screen.queryByText("还有有效会员，无法删除")).toBeNull()
  })
  it("renders tier cards with member counts", async () => {
    mount()
    expect(await screen.findByText("1 位有效会员")).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
  it("enable switch confirms before saving", async () => {
    mount()
    fireEvent.click(await screen.findByRole("switch", { name: "上架 VIP" }))
    expect(api.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "确认下架" }))
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    expect(api.save.mock.calls[0][1]).toEqual({
      name: "VIP",
      level: 1,
      monthlyPriceFen: "10000",
      tagline: "",
      cardStyle: "rose",
      benefits: ["保留权益"],
      enabled: false,
      options: [
        {
          id: "option-original",
          months: 3,
          discountKind: "percent",
          discountValue: "7500",
          badge: "专属",
          recommended: true,
          enabled: true,
        },
      ],
    })
  })
  it("delete conflict offers unpublish", async () => {
    api.remove.mockRejectedValue(new ApiError(409, { code: "INVALID_STATE" }))
    mount()
    fireEvent.keyDown(await screen.findByRole("button", { name: "更多 VIP" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }))
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
    fireEvent.click(await screen.findByRole("button", { name: "改为下架" }))
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        tier.id,
        expect.objectContaining({ enabled: false }),
        expect.any(Function),
      ),
    )
  })
  it("editor shows live preview prices", async () => {
    api.preview.mockResolvedValue({ ...tier, options: [{ ...tier.options[0], priceFen: "13500" }] })
    const dialog = await edit()
    expect(await within(dialog).findByText("现价 ¥135.00")).toBeTruthy()
    expect(within(dialog).getByRole("region", { name: "用户端预览" }).textContent).toContain(
      "¥135.00",
    )
  })
  it("only one recommended option", async () => {
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "添加档位" }))
    fireEvent.click(screen.getByRole("button", { name: "添加档位" }))
    const first = screen.getByRole("button", { name: "推荐 1" })
    fireEvent.click(first)
    fireEvent.click(first)
    expect(first.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "推荐 3" }))
    expect(first.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(screen.getByRole("button", { name: "推荐 3" }))
    expect(screen.getByRole("button", { name: "推荐 3" }).getAttribute("aria-pressed")).toBe(
      "false",
    )
  })
  it("dirty close asks confirmation and retains all fields", async () => {
    await edit()
    fireEvent.change(screen.getByLabelText("标语"), { target: { value: "新标语" } })
    fireEvent.change(screen.getByLabelText("权益 1"), { target: { value: "新权益" } })
    fireEvent.change(screen.getByLabelText("角标 1"), { target: { value: "新角标" } })
    fireEvent.click(screen.getByRole("radio", { name: "gold" }))
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(screen.getByText("放弃未保存的修改？")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    expect(screen.getByLabelText("标语").getAttribute("value")).toBe("新标语")
    expect(screen.getByLabelText("权益 1").getAttribute("value")).toBe("新权益")
    expect(screen.getByLabelText("角标 1").getAttribute("value")).toBe("新角标")
    expect(screen.getByRole("radio", { name: "gold" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }))
    fireEvent.click(screen.getByRole("button", { name: "编辑 VIP" }))
    expect(screen.getByLabelText("标语").getAttribute("value")).toBe("")
  })
  it("benefits support ordering deletion and eight-item limit", async () => {
    await edit()
    fireEvent.click(screen.getByRole("button", { name: "添加权益" }))
    fireEvent.change(screen.getByLabelText("权益 2"), { target: { value: "第二条" } })
    fireEvent.click(screen.getByRole("button", { name: "上移权益 2" }))
    expect(screen.getByLabelText("权益 1").getAttribute("value")).toBe("第二条")
    fireEvent.click(screen.getByRole("button", { name: "下移权益 1" }))
    fireEvent.click(screen.getByRole("button", { name: "删除权益 2" }))
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByRole("button", { name: "添加权益" }))
    expect(screen.getByRole("button", { name: "添加权益" }).hasAttribute("disabled")).toBe(true)
  })
  it("renders three loading skeletons and an authorized empty action", async () => {
    api.list.mockReturnValue(new Promise(() => {}))
    const view = mount()
    expect(
      screen.getByLabelText("加载会员等级").querySelectorAll('[data-slot="skeleton"]'),
    ).toHaveLength(3)
    expect(screen.queryByText("加载中…")).toBeNull()
    view.unmount()
    api.list.mockResolvedValue({ items: [] })
    mount()
    expect(await screen.findByText("还没有会员等级")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "新建等级" })).toHaveLength(2)
  })
  it("shows field errors and readonly saved server prices", async () => {
    const view = await edit()
    fireEvent.change(screen.getByLabelText("标语"), { target: { value: "😀".repeat(25) } })
    expect(within(view).getByLabelText("字段错误").textContent).toContain("标语最多 24 个字")
  })
  it("permission downgrade discards unsaved draft and shows only stored prices", async () => {
    const view = mount()
    fireEvent.click(await screen.findByRole("button", { name: "编辑 VIP" }))
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "未保存名称" } })
    auth.permissions = ["membership:read"]
    view.rerenderPage()
    expect(screen.getByLabelText("名称").getAttribute("value")).toBe("VIP")
    expect(screen.getByRole("region", { name: "用户端预览" }).textContent).toContain("¥225.00")
    expect(screen.queryByRole("switch", { name: "上架 VIP" })).toBeNull()
    expect(screen.queryByRole("button", { name: "更多 VIP" })).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(api.preview).not.toHaveBeenCalled()
    expect(api.save).not.toHaveBeenCalled()
    expect(api.remove).not.toHaveBeenCalled()
  })
  it("identity change removes dirty sheet and confirmation", async () => {
    const view = mount()
    fireEvent.click(await screen.findByRole("button", { name: "编辑 VIP" }))
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "旧管理员草稿" } })
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    auth.id = "new-owner"
    view.rerenderPage()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText("放弃未保存的修改？")).toBeNull()
  })
  it("places recommended conflict on the option group", async () => {
    api.list.mockResolvedValue({
      items: [{ ...tier, options: [tier.options[0], { ...tier.options[0], id: "duplicate" }] }],
    })
    const dialog = await edit()
    expect(within(dialog).getByRole("region", { name: "价格档位" }).textContent).toContain(
      "每个等级最多一个推荐档位",
    )
  })
  it("can retry list failures without exposing raw loading text", async () => {
    api.list.mockRejectedValueOnce(new Error("offline"))
    mount()
    expect(await screen.findByRole("alert")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByRole("button", { name: "编辑 VIP" })).toBeTruthy()
  })
})
