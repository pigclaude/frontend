// 负责声明第一阶段管理后台的登录、权限守卫和受保护页面路由。
import { createBrowserRouter, Navigate } from "react-router"
import { AdminGuard } from "@/components/admin-guard"
import { AdminShell } from "@/components/shell/admin-shell"
import LoginPage from "@/pages/login"
import OrdersPage from "@/pages/orders"
import UsersPage from "@/pages/users"
import TiersPage from "@/pages/tiers"
import TierEditorPage from "@/pages/tier-editor"
import MembershipPage from "@/pages/membership"
import DevicesPage from "@/pages/devices"
import SettingsSecurityPage from "@/pages/settings-security"
import AuditsPage from "@/pages/audits"

/** 管理后台路由树，所有业务页面都挂在 AdminGuard 和 AdminShell 之下。 */
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <AdminGuard />,
    children: [
      {
        element: <AdminShell />,
        children: [
          { index: true, element: <Navigate to="/users" replace /> },
          { path: "orders", element: <OrdersPage /> },
          { path: "users", element: <UsersPage /> },
          { path: "tiers", element: <TiersPage /> },
          { path: "tiers/new", element: <TierEditorPage /> },
          { path: "tiers/:tierId", element: <TierEditorPage /> },
          { path: "membership", element: <MembershipPage /> },
          { path: "devices", element: <DevicesPage /> },
          { path: "audits", element: <AuditsPage /> },
          { path: "settings", element: <SettingsSecurityPage /> },
        ],
      },
    ],
  },
])
