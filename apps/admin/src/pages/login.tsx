// 负责管理员账号登录，登录成功后由服务端 cookie 和 me query 确认身份。
import { FormEvent, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router"
import { toast } from "sonner"
import { adminApi } from "@/lib/api"
import { toastApiError } from "@/lib/errors"
import { safeLoginRedirect } from "@/lib/navigation"

/** 渲染管理员登录表单，密码只进入 API body，不进入 URL 或页面状态展示。 */
export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (account.trim().length < 3 || password.length < 8) {
      toast.error("请输入有效的账号和至少 8 位密码")
      return
    }
    setPending(true)
    try {
      await adminApi.auth.login({ account: account.trim(), password })
      await queryClient.invalidateQueries({ queryKey: ["admin-me"], refetchType: "all" })
      toast.success("登录成功")
      navigate(safeLoginRedirect(new URLSearchParams(location.search).get("redirect")), {
        replace: true,
      })
    } catch (error) {
      toastApiError(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <main style={{ display: "grid", minHeight: "100vh", placeItems: "center", padding: 20 }}>
      <section className="admin-card" style={{ width: "min(420px, 100%)", padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>登录 Pigclaude 管理后台</h1>
        <p className="admin-muted">仅限拥有服务端权限的运营人员。</p>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
          <div className="admin-field">
            <label htmlFor="admin-account">账号</label>
            <input
              id="admin-account"
              autoComplete="username"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
            />
          </div>
          <div className="admin-field">
            <label htmlFor="admin-password">密码</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button className="admin-button primary" type="submit" disabled={pending}>
            {pending ? "登录中…" : "登录"}
          </button>
        </form>
      </section>
    </main>
  )
}
