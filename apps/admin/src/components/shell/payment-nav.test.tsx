// 负责真实侧栏中 payment-only 管理员的订单和系统设置可达性。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { expect, it, vi } from "vitest"
import { SideNav } from "./side-nav"
import { TooltipProvider } from "@/components/ui/tooltip"
vi.mock("@/lib/api", () => ({ adminApi: { me: vi.fn() } }))
it("offers orders and settings to payment-only operator without tiers", () => {
  const client = new QueryClient()
  client.setQueryData(["admin-me"], { id: "ops", status: "active", permissions: ["payment:read"] })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <SideNav
            rail={false}
            onNavigate={() => {}}
            onLogout={() => {}}
            onOpenCmdk={() => {}}
            inactive={false}
            navigationRef={null}
            onInactiveMenuClose={() => {}}
            onNavigationKeyDown={() => {}}
            logoutPending={false}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(screen.getByRole("link", { name: "订单" }).getAttribute("href")).toBe("/orders")
  expect(screen.getByRole("link", { name: "系统设置" }).getAttribute("href")).toBe("/settings")
  expect(screen.queryByRole("link", { name: "会员等级" })).toBeNull()
})
