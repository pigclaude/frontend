// 负责管理员账号登录，登录成功后由服务端 cookie 和 me query 确认身份。
import { FormEvent, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router"
import { toast } from "sonner"
import { ArrowLeft, LoaderCircle, LockKeyhole, UserRound } from "lucide-react"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import { captchaErrorMessage } from "@pigclaude/web-ui/lib/captcha-errors"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemeButton } from "@/components/theme-button"
import { BrandMark } from "@/components/shell/brand-mark"
import { adminApi } from "@/lib/api"
import { toastApiError } from "@/lib/errors"
import { resolveHomeOrigin } from "@/lib/runtime-config"
import { safeLoginRedirect } from "@/lib/navigation"

/** 渲染管理员登录表单，密码只进入 API body，不进入 URL 或页面状态展示。 */
export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [captchaError, setCaptchaError] = useState<string | null>(null)
  const submitting = useRef(false)
  const captcha = useTurnstileCaptcha({
    loadConfig: adminApi.auth.captcha,
    action: "admin_login",
  })

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !captcha.ready) return
    if (account.trim().length < 3 || password.length < 8) {
      toast.error("请输入有效的账号和至少 8 位密码")
      return
    }
    submitting.current = true
    setPending(true)
    setCaptchaError(null)
    try {
      await captcha.run((captchaToken) =>
        adminApi.auth.login({
          account: account.trim(),
          password,
          ...(captchaToken ? { captchaToken } : {}),
        }),
      )
      await queryClient.invalidateQueries({ queryKey: ["admin-me"], refetchType: "all" })
      toast.success("登录成功")
      navigate(safeLoginRedirect(new URLSearchParams(location.search).get("redirect")), {
        replace: true,
      })
    } catch (error) {
      const message = captchaErrorMessage(error)
      if (message) {
        setCaptchaError(message)
        captcha.retry()
      } else toastApiError(error)
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-280px] left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--hero-glow),transparent)]" />
        <div className="absolute inset-0 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent)] bg-[linear-gradient(to_right,var(--border-soft)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-soft)_1px,transparent_1px)] bg-[size:44px_44px]" />
      </div>
      <ThemeButton className="fixed top-4 right-4" />
      <div className="relative flex w-full max-w-[400px] animate-in flex-col gap-7 duration-500 fade-in-0 slide-in-from-bottom-2">
        <div className="flex flex-col items-center gap-4 text-center">
          <BrandMark className="size-11 rounded-xl" />
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
              登录 Pigclaude 管理后台
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              仅限运营人员，使用管理员账号登录
            </p>
          </div>
        </div>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-[var(--card-elevated)]/80 p-6 shadow-[var(--dialog-shadow)] backdrop-blur-xl"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-account" className="text-[13px] font-medium text-fg-2">
              账号
            </label>
            <div className="relative">
              <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta" />
              <Input
                id="admin-account"
                autoComplete="username"
                placeholder="admin_ops"
                className="h-10 pl-9 text-sm"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="admin-password" className="text-[13px] font-medium text-fg-2">
              密码
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-meta" />
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                placeholder="至少 8 位"
                className="h-10 pl-9 text-sm"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>
          <TurnstileCaptcha {...captcha.field} />
          {captchaError && (
            <p role="alert" className="text-sm text-destructive">
              {captchaError}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="mt-1 h-10 w-full"
            disabled={pending || !captcha.ready}
          >
            {pending && <LoaderCircle className="animate-spin" />}
            {pending ? "登录中…" : "登录"}
          </Button>
        </form>
        <p className="text-center text-xs text-meta">
          <a
            href={resolveHomeOrigin(import.meta.env.VITE_HOME_URL)}
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            返回官网
          </a>
        </p>
      </div>
    </main>
  )
}
