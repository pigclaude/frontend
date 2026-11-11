// 负责管理员独立 RP 入口：无错误时立即 replace 到 Admin RP start，带错误或 10 秒内重复自动发起时只显示提示和重试；密码与验证码交互留在中央 Admin 表单。
import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"
import { beginWebOidcLogin } from "@pigclaude/api/web-oidc"
import { claimAutoStart } from "@pigclaude/api/auto-start-guard"
import { LineIcon } from "@pigclaude/web-ui/components/line-icon"
import { Button } from "@/components/ui/button"
import { AccentPicker } from "@pigclaude/web-ui/components/accent-picker"
import { ThemeButton } from "@/components/theme-button"
import { BrandMark } from "@/components/shell/brand-mark"
import { resolveHomeOrigin } from "@/lib/runtime-config"
import { safeLoginRedirect } from "@/lib/navigation"
const errors: Record<string, string> = {
  OIDC_ACCESS_DENIED: "已取消登录，可点击重新登录",
  OIDC_LOGIN_REQUIRED: "请重新登录后继续",
  OIDC_FAILED: "登录未完成，请重试",
  OIDC_UNAVAILABLE: "登录服务暂时不可用，请稍后重试",
  ACCOUNT_BANNED: "账号不可用，请联系管理员",
}
/** 无已知错误码时立即启动 Admin RP（仅一次）；回调错误或 10 秒内重复自动发起不会自动创建新事务。 */
export default function LoginPage() {
  const params = new URLSearchParams(useLocation().search)
  const code = params.get("oidcError") ?? ""
  const error = Object.hasOwn(errors, code) ? errors[code] : undefined
  const returnTo = safeLoginRedirect(params.get("redirect"))
  const started = useRef(false)
  // 10 秒内再次自动发起时停下，改为显示「重新登录」，避免 401 与 SSO 之间来回跳转。
  const [held, setHeld] = useState(false)
  const start = () => beginWebOidcLogin({ site: "admin", returnTo }, { replace: true })
  useEffect(() => {
    if (error || started.current) return
    started.current = true
    if (claimAutoStart("admin")) start()
    else setHeld(true)
    // 只在挂载时依据首次参数决定是否自动跳转。
  }, [])
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-280px] left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--hero-glow),transparent)]" />
        <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent)] bg-[linear-gradient(to_right,var(--border-soft)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-soft)_1px,transparent_1px)] bg-[size:44px_44px]" />
      </div>
      <div className="fixed top-4 right-4 flex items-center gap-2">
        <AccentPicker />
        <ThemeButton />
      </div>
      <div className="relative flex w-full max-w-[400px] animate-in flex-col gap-7 duration-500 fade-in-0 slide-in-from-bottom-2">
        <div className="flex flex-col items-center gap-4 text-center">
          <BrandMark className="size-11 rounded-xl" />
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">登录管理后台</h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">仅限运营人员使用管理员账号</p>
          </div>
        </div>
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-[var(--card-elevated)]/80 p-6 shadow-[var(--dialog-shadow)] backdrop-blur-xl">
          {error || held ? (
            <>
              {error && (
                <p role="alert" className="text-sm text-danger-ink">
                  {error}
                </p>
              )}
              <Button size="lg" onClick={start}>
                重新登录
              </Button>
            </>
          ) : (
            <p role="status" className="text-center text-sm text-muted-foreground">
              正在前往登录…
            </p>
          )}
        </section>
        <p className="text-center text-xs text-meta">
          <a
            href={resolveHomeOrigin(import.meta.env.VITE_HOME_URL)}
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <LineIcon name="arrow-left" className="size-3.5" />
            返回官网
          </a>
        </p>
      </div>
    </main>
  )
}
