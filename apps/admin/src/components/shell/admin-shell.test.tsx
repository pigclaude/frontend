// 负责验证迁入外壳的移动导航、桌面折叠和真实入口范围。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminShell } from "./admin-shell"

vi.mock("@/hooks/use-admin-me", () => ({ useAdminMe: () => ({ data: { account: "admin" } }) }))
vi.mock("@/lib/api", () => ({ adminApi: { auth: { logout: vi.fn() } } }))

function renderShell(mobile = false) {
  let matches = mobile
  const listeners = new Set<() => void>()
  vi.stubGlobal("matchMedia", () => ({
    matches,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }))
  const result = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/users"]}>
        <AdminShell />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return {
    ...result,
    resize: (mobile: boolean) => {
      matches = mobile
      act(() => listeners.forEach((listener) => listener()))
    },
  }
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

  it("isolates the closed mobile navigation and restores trigger focus after Escape", () => {
    const { container } = renderShell(true)
    const side = container.querySelector("aside")
    const toggle = screen.getByRole("button", { name: "打开导航菜单" })
    expect(side?.hasAttribute("inert")).toBe(true)
    expect(screen.queryByRole("complementary", { name: "管理后台导航" })).toBeNull()
    expect(screen.queryByRole("link", { name: "设备绑定" })).toBeNull()
    fireEvent.click(toggle)
    expect(side?.hasAttribute("inert")).toBe(false)
    const first = screen.getByRole("link", { name: "pigclaude 管理后台首页" })
    const account = screen.getByRole("button", { name: "账号菜单" })
    expect(side?.contains(document.activeElement)).toBe(true)
    expect(toggle.closest("[inert]")).toBeTruthy()
    account.focus()
    fireEvent.keyDown(account, { key: "Tab" })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(account)
    fireEvent.keyDown(account, { key: "Escape" })
    expect(side?.hasAttribute("inert")).toBe(true)
    expect(document.activeElement).toBe(toggle)
    expect(toggle.closest("[inert]")).toBeNull()
  })

  it("lets the portaled account menu handle Escape before the mobile drawer", async () => {
    const { container } = renderShell(true)
    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }))
    const account = screen.getByRole("button", { name: "账号菜单" })
    fireEvent.keyDown(account, { key: "Enter" })
    const menu = await screen.findByRole("menu")
    expect(container.querySelector("aside")?.contains(menu)).toBe(false)
    fireEvent.keyDown(menu, { key: "ArrowDown" })
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    fireEvent(menu, tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(screen.getByRole("menu")).toBe(menu)
    fireEvent.keyDown(menu, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(container.querySelector(".side-open")).toBeTruthy()
    expect(document.activeElement).toBe(account)
    fireEvent.keyDown(account, { key: "Escape" })
    expect(container.querySelector(".side-open")).toBeNull()
  })

  it("keeps portaled account actions usable inside mobile navigation", async () => {
    delete document.documentElement.dataset.theme
    const { container } = renderShell(true)
    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }))
    const account = screen.getByRole("button", { name: "账号菜单" })
    fireEvent.keyDown(account, { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "切换明暗主题" }))
    expect(document.documentElement.dataset.theme).toBe("light")
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(container.querySelector(".side-open")).toBeTruthy()
    expect(document.activeElement).toBe(account)
    delete document.documentElement.dataset.theme
  })

  it("returns focus to the visible trigger when a shortcut closes a portaled menu", async () => {
    const { container } = renderShell(true)
    const toggle = screen.getByRole("button", { name: "打开导航菜单" })
    fireEvent.click(toggle)
    fireEvent.keyDown(screen.getByRole("button", { name: "账号菜单" }), { key: "Enter" })
    const menu = await screen.findByRole("menu")
    fireEvent.keyDown(menu, { key: "b", ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(container.querySelector("aside[inert]")).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(toggle))
  })

  it("removes mobile isolation on desktop and closes again on returning to mobile", () => {
    const { container, resize } = renderShell(true)
    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }))
    resize(false)
    expect(container.querySelector("aside[inert]")).toBeNull()
    expect(screen.getByRole("button", { name: "收起侧栏" }).closest("[inert]")).toBeNull()
    expect(screen.getByRole("link", { name: "设备绑定" })).toBeTruthy()
    resize(true)
    expect(container.querySelector("aside[inert]")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "设备绑定" })).toBeNull()
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
