// 负责验证迁入外壳的移动导航、桌面折叠和真实入口范围。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminShell } from "./admin-shell"

vi.mock("@/hooks/use-admin-me", () => ({ useAdminMe: () => ({ data: { account: "admin" } }) }))
vi.mock("@/lib/api", () => ({ adminApi: { auth: { logout: vi.fn() } } }))

function renderShell(mobile = false) {
  vi.stubGlobal("matchMedia", () => ({
    matches: mobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/users"]}>
        <AdminShell />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("AdminShell navigation", () => {
  beforeEach(() => localStorage.clear())

  it("opens mobile navigation and closes it after choosing a real page", () => {
    const { container } = renderShell(true)
    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }))
    expect(container.querySelector(".admin-shell.side-open")).toBeTruthy()
    fireEvent.click(screen.getByRole("link", { name: "设备绑定" }))
    expect(container.querySelector(".admin-shell.side-open")).toBeNull()
  })

  it("persists desktop rail and only exposes the four supported pages", () => {
    const { container } = renderShell()
    fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }))
    expect(container.querySelector("aside[data-rail=true]")).toBeTruthy()
    expect(localStorage.getItem("pigclaude-admin-sidebar")).toBe("rail")
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/users",
      "/users",
      "/membership",
      "/devices",
      "/audits",
    ])
  })
})
