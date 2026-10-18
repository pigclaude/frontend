// 负责验证迁入顶栏的会话入口与移动菜单焦点、关闭行为。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Nav } from "@/components/nav"

const mocks = vi.hoisted(() => ({ me: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }))
vi.mock("@/lib/api", () => ({ homeApi: { user: { me: mocks.me } } }))

beforeEach(() => {
  mocks.me.mockResolvedValue({ nickname: "Ada" })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderNav(variant: "app" | "auth" | "marketing" = "app") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Nav variant={variant} />
    </QueryClientProvider>,
  )
}

describe("migrated home topbar", () => {
  it("shows the account entry instead of registration for a live session", async () => {
    renderNav()
    expect(await screen.findByRole("link", { name: "我的账户" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "创建账户" })).toBeNull()
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
