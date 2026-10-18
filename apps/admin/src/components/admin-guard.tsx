// 负责保护管理后台路由，只有服务端确认的管理员 session 才能进入 shell。
import { Navigate, Outlet, useLocation } from "react-router"
import { useAdminMe } from "@/hooks/use-admin-me"
import { loginRedirectPath } from "@/lib/navigation"

/** 显示最小加载态，避免未确认身份时闪出受保护的后台数据。 */
function GuardLoading() {
  return (
    <main
      className="flex min-h-dvh items-center justify-center text-[13px] text-muted-foreground"
      aria-busy="true"
    >
      正在验证管理员会话…
    </main>
  )
}

/** 管理员路由守卫，401、403 和网络未知状态都回到登录页。 */
export function AdminGuard() {
  const { isPending, error, data } = useAdminMe()
  const location = useLocation()
  if (isPending) return <GuardLoading />
  if (error || !data) {
    return (
      <Navigate to={loginRedirectPath(location.pathname, location.search, location.hash)} replace />
    )
  }
  return <Outlet />
}
