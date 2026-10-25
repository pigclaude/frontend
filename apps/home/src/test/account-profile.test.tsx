// 负责验证个人资料页：身份卡、会员标签、昵称就地编辑与顶栏同步、用户 ID 复制。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@pigclaude/api/client"
import { webOidcNavigation } from "@pigclaude/api/web-oidc"
import { Nav } from "@/components/nav"
import { Providers } from "@/components/providers"
import AccountProfilePage from "@/app/(app)/account/page"
import { accountUser, activeEntitlement, noEntitlement } from "./account-fixtures"

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  updateProfile: vi.fn(),
  entitlement: vi.fn(),
  toast: vi.fn(),
  writeText: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/account",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/api", () => ({
  homeApi: {
    user: { me: mocks.me, updateProfile: mocks.updateProfile },
    membership: { entitlement: mocks.entitlement },
    auth: { logout: vi.fn() },
  },
}))
vi.mock("sonner", () => ({ toast: { success: mocks.toast, error: mocks.toast } }))

function renderPage() {
  return render(
    <Providers>
      <Nav />
      <AccountProfilePage />
    </Providers>,
  )
}
async function openNicknameEditor() {
  fireEvent.click(await screen.findByRole("button", { name: "编辑昵称" }))
  return screen.getByRole("textbox", { name: "昵称" })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(webOidcNavigation, "replace").mockImplementation(() => undefined)
  mocks.me.mockResolvedValue(accountUser())
  mocks.entitlement.mockResolvedValue(activeEntitlement())
  mocks.writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("account profile page", () => {
  it("shows nickname, email, join month and membership badge", async () => {
    renderPage()
    const hero = await screen.findByRole("region", { name: "林小猪" })
    expect(within(hero).getByText("lin@example.com · 2026 年 10 月加入")).toBeTruthy()
    expect(await within(hero).findByText("VIP · 2027/10/19 到期")).toBeTruthy()
    expect(within(hero).getByRole("img", { name: "林小猪" }).textContent).toBe("林")
    expect(screen.getByText("谷歌 / GitHub 注册用对方头像，其余显示首字")).toBeTruthy()
    expect(screen.getByText("100001")).toBeTruthy()
  })

  it("links to /membership when there is no membership", async () => {
    mocks.entitlement.mockResolvedValue(noEntitlement())
    renderPage()
    const link = await screen.findByRole("link", { name: "未开通会员" })
    expect(link.getAttribute("href")).toBe("/membership")
  })

  it("edits nickname inline: Enter saves, Esc cancels, blank shows an error", async () => {
    mocks.updateProfile.mockResolvedValue(accountUser({ nickname: "猪猪侠" }))
    renderPage()
    let input = await openNicknameEditor()
    expect((input as HTMLInputElement).value).toBe("林小猪")
    fireEvent.change(input, { target: { value: "改了又反悔" } })
    fireEvent.keyDown(input, { key: "Escape" })
    expect(screen.queryByRole("textbox", { name: "昵称" })).toBeNull()
    expect(mocks.updateProfile).not.toHaveBeenCalled()

    input = await openNicknameEditor()
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect((await screen.findByRole("alert")).textContent).toBe("昵称不能为空")
    expect(mocks.updateProfile).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "字".repeat(33) } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect((await screen.findByRole("alert")).textContent).toBe("昵称最多 32 个字")

    fireEvent.change(input, { target: { value: "  猪猪侠 " } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "昵称" })).toBeNull())
    expect(mocks.updateProfile).toHaveBeenCalledWith({ nickname: "猪猪侠" }, expect.any(Function))
    expect(await screen.findByRole("region", { name: "猪猪侠" })).toBeTruthy()
  })

  it("counts emoji as single characters", async () => {
    mocks.updateProfile.mockResolvedValue(accountUser({ nickname: "🐷".repeat(32) }))
    renderPage()
    const input = await openNicknameEditor()
    fireEvent.change(input, { target: { value: "🐷".repeat(32) } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalled())
  })

  it("keeps the editor open with a readable message when saving fails", async () => {
    mocks.updateProfile.mockRejectedValue(new ApiError(400, { code: "INVALID_INPUT" }))
    renderPage()
    const input = await openNicknameEditor()
    fireEvent.change(input, { target: { value: "新名字" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    expect((await screen.findByRole("alert")).textContent).toBe("昵称不符合要求，请换一个")
    expect(screen.getByRole("textbox", { name: "昵称" })).toBeTruthy()
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("updates the header menu after saving", async () => {
    mocks.updateProfile.mockResolvedValue(accountUser({ nickname: "猪猪侠" }))
    renderPage()
    const input = await openNicknameEditor()
    fireEvent.change(input, { target: { value: "猪猪侠" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(
        within(screen.getByRole("button", { name: "用户菜单" })).getByRole("img").textContent,
      ).toBe("猪"),
    )
    expect(mocks.me).toHaveBeenCalledTimes(1)
  })

  it("copies the numeric user id", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "复制用户 ID" }))
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith("100001"))
    expect(mocks.toast).toHaveBeenCalledWith("已复制")
  })
})
