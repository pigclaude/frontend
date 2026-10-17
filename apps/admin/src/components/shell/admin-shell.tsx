// 负责提供管理后台的响应式导航外壳、管理员身份和退出操作。
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router"
import { toast } from "sonner"
import { adminApi } from "@/lib/api"
import { pageTitle, NAV } from "@/lib/nav"
import { toastApiError } from "@/lib/errors"
import { useAdminMe } from "@/hooks/use-admin-me"

/** 包裹受保护页面并提供用户、会员、设备、审计四个第一阶段入口。 */
export function AdminShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useAdminMe()
  const logout = useMutation({
    mutationFn: adminApi.auth.logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["admin-me"] })
      toast.success("已退出管理员账号")
      navigate("/login", { replace: true })
    },
    onError: toastApiError,
  })

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="管理后台导航">
        <strong>Pigclaude Admin</strong>
        <p className="admin-muted">第一阶段运营工具</p>
        <nav className="admin-nav">
          {NAV.map((item) => (
            <NavLink key={item.href} to={item.href} end={item.href === "/users"}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <div>
            <strong>{pageTitle(location.pathname)}</strong>
            <span className="admin-muted"> · 服务端权威数据</span>
          </div>
          <div className="admin-form-row">
            <span className="admin-muted">{me.data?.account ?? "管理员"}</span>
            <button
              className="admin-button"
              type="button"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {logout.isPending ? "退出中…" : "退出"}
            </button>
          </div>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
