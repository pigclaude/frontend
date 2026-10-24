// 负责验证迁入顶栏的会话入口与移动菜单焦点、关闭行为。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Providers } from "@/components/providers"
import { Nav } from "@/components/nav"
import { ApiError } from "@pigclaude/api/client"

const mocks = vi.hoisted(() => ({ me: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock("@/lib/api", () => ({ homeApi: { user: { me: mocks.me } } }))

beforeEach(() => {
  mocks.me.mockResolvedValue({ id: "user-12345678", nickname: "Ada", email: "ada@example.com" })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderNav(variant: "app" | "auth" | "marketing" = "app") {
  return render(
    <Providers>
      <Nav variant={variant} />
    </Providers>,
  )
}

describe("migrated home topbar", () => {
  it("shows the account entry instead of registration for a live session", async () => {
    renderNav()
    expect(await screen.findByRole("button", { name: "用户菜单" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "创建账户" })).toBeNull()
  })

  it("offers login and registration without a user menu for guests", async () => {
    mocks.me.mockRejectedValueOnce(new Error("guest"))
    renderNav("marketing")
    expect(await screen.findByRole("link", { name: "登录" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "创建账户" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "用户菜单" })).toBeNull()
  })

  it("offers a reconnect entry instead of an empty header while the session is unconfirmed", async () => {
    mocks.me.mockRejectedValue(new ApiError(503, { code: "AUTH_UNAVAILABLE" }))
    renderNav()
    const reconnect = await screen.findByRole("button", { name: "重新连接" }, { timeout: 4000 })
    expect(screen.queryByRole("link", { name: "登录" })).toBeNull()
    mocks.me.mockResolvedValue({ id: "user-12345678", nickname: "Ada", email: "ada@example.com" })
    fireEvent.click(reconnect)
    expect(await screen.findByRole("button", { name: "用户菜单" })).toBeTruthy()
  })

  it("keeps the authentication header compact without a session request", () => {
    renderNav("auth")
    expect(screen.getByRole("link", { name: "返回官网" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "打开菜单" })).toBeNull()
    expect(mocks.me).not.toHaveBeenCalled()
  })

  it("opens a labelled menu, focuses its first link and closes after a choice", async () => {
    renderNav("marketing")
    fireEvent.click(screen.getByRole("button", { name: "打开菜单" }))
    const dialog = await screen.findByRole("dialog", { name: "主菜单" })
    const product = within(dialog).getByRole("link", { name: "产品" })
    await waitFor(() => expect(document.activeElement).toBe(product))
    fireEvent.click(product)
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "主菜单" })).toBeNull())
  })
})
