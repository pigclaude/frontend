// 验证等级编辑的服务端价格、精确单位、权限及不可变身份合同。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import TiersPage from "./tiers"
import TierEditorPage from "./tier-editor"

const api = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  setEnabled: vi.fn(),
}))
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
function routerAt(pathname: string) {
  return createMemoryRouter(
    [
      { path: "/tiers", element: <TiersPage /> },
      { path: "/tiers/new", element: <TierEditorPage /> },
      { path: "/tiers/:tierId", element: <TierEditorPage /> },
    ],
    { initialEntries: [pathname] },
  )
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let router = routerAt("/tiers")
  const tree = () => (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  const view = render(tree())
  return {
    ...view,
    rerenderPage: () => {
      router = routerAt(router.state.location.pathname)
      view.rerender(tree())
    },
  }
}
async function edit() {
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "编辑 VIP" }))
  await screen.findByRole("heading", { name: /编辑 VIP/ })
  return screen.getByTestId("tier-editor")
}
function description(control: HTMLElement) {
  return (control.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
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
    expect(screen.getByRole("button", { name: "确认删除" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "改为下架" }).hasAttribute("disabled")).toBe(false)
  })
  it("creates a tier with code and exact amount without floating point conversion", async () => {
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "新建等级" }))
    await screen.findByRole("heading", { name: "新建等级" })
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
    expect(description(screen.getByLabelText("月价（元）"))).toContain("精度")
    expect(screen.queryByRole("alert")).toBeNull()
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
    expect(screen.getByRole("button", { name: "确认删除" }).hasAttribute("disabled")).toBe(false)
  })
  it("renders tier cards with member counts", async () => {
    mount()
    expect(await screen.findByText("1 位有效会员")).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
  it("enable switch confirms, then changes only enabled without resaving the tier", async () => {
    mount()
    fireEvent.click(await screen.findByRole("switch", { name: "上架 VIP" }))
    expect(api.setEnabled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "确认下架" }))
    await waitFor(() =>
      expect(api.setEnabled).toHaveBeenCalledWith(tier.id, false, expect.any(Function)),
    )
    expect(api.save).not.toHaveBeenCalled()
  })
  it("delete conflict offers unpublish", async () => {
    api.remove.mockRejectedValue(new ApiError(409, { code: "INVALID_STATE" }))
    mount()
    fireEvent.keyDown(await screen.findByRole("button", { name: "更多 VIP" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除" }))
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }))
    fireEvent.click(await screen.findByRole("button", { name: "改为下架" }))
    await waitFor(() =>
      expect(api.setEnabled).toHaveBeenCalledWith(tier.id, false, expect.any(Function)),
    )
    expect(api.save).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole("radio", { name: "金" }))
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(screen.getByText("放弃未保存的修改？")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }))
    expect(screen.getByLabelText("标语").getAttribute("value")).toBe("新标语")
    expect(screen.getByLabelText("权益 1").getAttribute("value")).toBe("新权益")
    expect(screen.getByLabelText("角标 1").getAttribute("value")).toBe("新角标")
    expect(screen.getByRole("radio", { name: "金" }).getAttribute("aria-checked")).toBe("true")
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
  it("shows the tagline error under the tagline input", async () => {
    const view = await edit()
    const tagline = screen.getByLabelText("标语")
    fireEvent.change(tagline, { target: { value: "😀".repeat(25) } })
    expect(tagline.getAttribute("aria-invalid")).toBe("true")
    expect(description(tagline)).toBe("标语最多 24 个字")
    expect(tagline.nextElementSibling?.textContent).toBe("标语最多 24 个字")
    expect(within(view).queryByLabelText("字段错误")).toBeNull()
  })
  it("new tier shows field errors under inputs only after editing or saving", async () => {
    mount()
    fireEvent.click(await screen.findByRole("button", { name: "新建等级" }))
    const dialog = await screen.findByTestId("tier-editor")
    for (const text of ["请填写名称", "请填写代号", "精度"])
      expect(dialog.textContent).not.toContain(text)
    for (const label of ["名称", "代号", "等级", "月价（元）", "标语", "月数 1", "角标 1"])
      expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe("false")
    const name = screen.getByLabelText("名称")
    fireEvent.change(name, { target: { value: "金卡" } })
    fireEvent.change(name, { target: { value: "" } })
    expect(name.getAttribute("aria-invalid")).toBe("true")
    expect(description(name)).toBe("请填写名称")
    expect(name.nextElementSibling?.textContent).toBe("请填写名称")
    expect(screen.getByLabelText("代号").getAttribute("aria-invalid")).toBe("false")
    expect(dialog.textContent).not.toContain("请填写代号")
    fireEvent.change(screen.getByLabelText("等级"), { target: { value: "0" } })
    expect(description(screen.getByLabelText("等级"))).toBe("等级和月数超出范围")
    fireEvent.click(screen.getByRole("button", { name: "添加权益" }))
    expect(screen.getByLabelText("权益 1").getAttribute("aria-invalid")).toBe("false")
    expect(description(screen.getByLabelText("权益 1"))).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "保存等级" }))
    expect(api.save).not.toHaveBeenCalled()
    expect(description(screen.getByLabelText("代号"))).toBe("请填写代号")
    expect(description(screen.getByLabelText("月价（元）"))).toContain("精度")
    expect(description(screen.getByLabelText("权益 1"))).toBe("权益 1：权益不能为空")
    expect(document.activeElement).toBe(name)
    expect(screen.queryByRole("alert")).toBeNull()
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
  it("repeated errors describe the exact controls after add move and removal", async () => {
    await edit()
    const description = (control: HTMLElement) =>
      (control.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
    fireEvent.click(screen.getByRole("button", { name: "添加权益" }))
    // 刚添加的空白条目在填写或保存之前不报错。
    expect(description(screen.getByLabelText("权益 2"))).toBe("")
    fireEvent.change(screen.getByLabelText("权益 2"), { target: { value: "😀".repeat(25) } })
    fireEvent.click(screen.getByRole("button", { name: "上移权益 2" }))
    expect(description(screen.getByLabelText("权益 1"))).toContain("权益 1：每条权益最多 24 个字")
    expect(description(screen.getByLabelText("权益 2"))).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "删除权益 1" }))
    expect(description(screen.getByLabelText("权益 1"))).toBe("")
    fireEvent.click(screen.getByRole("button", { name: "添加档位" }))
    fireEvent.change(screen.getByLabelText("月数 2"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("角标 2"), { target: { value: "超过六个字角标" } })
    expect(description(screen.getByLabelText("月数 2"))).toContain("档位 2：")
    expect(description(screen.getByLabelText("角标 2"))).toContain("档位 2：角标最多 6 个字")
    fireEvent.click(screen.getByRole("button", { name: "移除档位 1" }))
    expect(description(screen.getByLabelText("月数 1"))).toContain("档位 1：")
    expect(screen.getByLabelText("月数 1").getAttribute("aria-invalid")).toBe("true")
    expect(description(screen.getByLabelText("角标 1"))).toContain("档位 1：角标最多 6 个字")
  })
})
