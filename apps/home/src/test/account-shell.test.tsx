// 负责验证个人中心外壳的导航结构、当前项标记和会员页使用的横向导航模式。
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AccountShell } from "@/components/account/account-shell"

const pathname = vi.hoisted(() => ({ value: "/account" }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }))

beforeEach(() => {
  pathname.value = "/account"
})
afterEach(cleanup)

describe("AccountShell", () => {
  it("renders both groups as a side navigation with all four items", () => {
    render(<AccountShell>内容</AccountShell>)
    const nav = screen.getByRole("navigation", { name: "个人中心" })
    expect(nav.getAttribute("data-variant")).toBe("side")
    expect(within(nav).getByText("账户")).toBeTruthy()
    expect(within(nav).getByText("订阅")).toBeTruthy()
    const links = within(nav).getAllByRole("link")
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["个人资料", "/account"],
      ["登录与安全", "/account/security"],
      ["设备管理", "/account/devices"],
      ["会员", "/membership"],
    ])
    expect(screen.getByText("内容")).toBeTruthy()
  })

  it("marks the current item with aria-current=page", () => {
    pathname.value = "/account/devices"
    render(<AccountShell>内容</AccountShell>)
    const nav = screen.getByRole("navigation", { name: "个人中心" })
    expect(within(nav).getByRole("link", { name: "设备管理" }).getAttribute("aria-current")).toBe(
      "page",
    )
    expect(within(nav).getByRole("link", { name: "个人资料" }).getAttribute("aria-current")).toBe(
      null,
    )
  })

  it("renders horizontal tabs only in compact mode", () => {
    pathname.value = "/membership"
    render(<AccountShell compact>会员内容</AccountShell>)
    const nav = screen.getByRole("navigation", { name: "个人中心" })
    expect(nav.getAttribute("data-variant")).toBe("tabs")
    expect(within(nav).queryByText("账户")).toBeNull()
    expect(within(nav).getByRole("link", { name: "会员" }).getAttribute("aria-current")).toBe(
      "page",
    )
    expect(screen.getAllByRole("navigation")).toHaveLength(1)
  })

  it("renders a single main landmark around the content", () => {
    render(
      <AccountShell compact className="membership-page">
        会员内容
      </AccountShell>,
    )
    const main = screen.getByRole("main")
    expect(main.className).toContain("page-shell")
    expect(main.className).toContain("membership-page")
    expect(within(main).getByText("会员内容")).toBeTruthy()
  })
})
