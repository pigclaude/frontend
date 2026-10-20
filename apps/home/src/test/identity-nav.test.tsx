// 负责验证中央身份页顶栏按交互 realm 在品牌旁显示「管理后台」标记。
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Providers } from "@/components/providers"
import { IdentityNav } from "@/components/identity/identity-nav"

const mocks = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/identity/login",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => mocks.params,
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderNav(query: string) {
  mocks.params = new URLSearchParams(query)
  return render(
    <Providers>
      <IdentityNav />
    </Providers>,
  )
}

describe("identity topbar realm marker", () => {
  it("shows the admin marker right beside the brand for Admin interactions", () => {
    renderNav("interactionId=interaction-1&realm=Admin")
    const brand = screen.getByRole("link", { name: "PigClaude" })
    const tag = screen.getByText("管理后台")
    expect(brand.closest("header")?.contains(tag)).toBe(true)
    expect(brand.nextElementSibling).toBe(tag)
  })

  it("omits the marker for User interactions", () => {
    renderNav("interactionId=interaction-1&realm=User")
    expect(screen.getByRole("link", { name: "PigClaude" })).toBeTruthy()
    expect(screen.queryByText("管理后台")).toBeNull()
  })
})
