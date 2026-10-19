// 负责验证真实侧栏和快速跳转按服务端权限隐藏系统设置。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, expect, it, vi } from "vitest"
import { SideNav } from "@/components/shell/side-nav"
import { Cmdk } from "@/components/shell/cmdk"
vi.mock("@/lib/api", () => ({
  adminApi: { me: async () => ({ status: "active", permissions: [] }) },
}))
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  HTMLElement.prototype.scrollIntoView = () => {}
})
it.each([
  [[], false],
  [["settings:read"], true],
  [["read"], false],
  [["settings:write"], false],
])("navigation reflects %j", (permissions, visible) => {
  const client = new QueryClient()
  client.setQueryData(["admin-me"], { account: "ops", status: "active", permissions })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SideNav
          inactive={false}
          navigationRef={null}
          onInactiveMenuClose={() => {}}
          onNavigationKeyDown={() => {}}
          logoutPending={false}
          rail={false}
          onNavigate={() => {}}
          onLogout={() => {}}
          onOpenCmdk={() => {}}
        />
        <Cmdk open={true} onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(screen.queryByRole("link", { name: "系统设置", hidden: true }) !== null).toBe(visible)
  expect(screen.queryByRole("option", { name: /系统设置/ }) !== null).toBe(visible)
})
