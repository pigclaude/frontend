// 负责验证码配置反馈与官方 widget 生命周期，主题、尺寸或重置时销毁旧回调作用域。
"use client"

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Shield } from "lucide-react"
import type { CaptchaAction, CaptchaConfig } from "@pigclaude/contracts/captcha"
import { Button } from "./button"
import { useIsLightTheme } from "../lib/theme-hook"
import { loadTurnstileSdk, type TurnstileSdk } from "../lib/turnstile-sdk"

/** 接收共享门禁的当前快照，供应商 token 只交给内存回调。 */
export interface TurnstileCaptchaProps {
  config: CaptchaConfig | null
  error: string | null
  action: CaptchaAction
  nonce: number
  busy: boolean
  onRetry: () => void
  onVerified: (token: string) => void
  onInvalidate: () => void
}

/** 在原认证表单内展示验证码；失败与过期均保留明确重试入口。 */
export function TurnstileCaptcha(props: TurnstileCaptchaProps) {
  if (props.config?.enabled === false) return null
  if (props.error) {
    return <CaptchaFeedback message={props.error} onRetry={props.onRetry} busy={props.busy} error />
  }
  if (!props.config) return <CaptchaFeedback message="正在加载验证码…" />
  return (
    <TurnstileWidget
      key={`${props.action}:${props.nonce}:${props.config.siteKey}:${props.config.mode}`}
      {...props}
      siteKey={props.config.siteKey}
    />
  )
}

function CaptchaFeedback({
  message,
  onRetry,
  error = false,
  busy = false,
  children,
}: {
  message: string
  onRetry?: () => void
  error?: boolean
  busy?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className="min-w-0 w-full rounded-md border border-border bg-[var(--input-bg)] p-3"
      aria-label="安全验证"
      aria-busy={busy}
    >
      <div className="flex items-start gap-2.5">
        <Shield aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-[13px] leading-5 font-medium text-[var(--fg-2)]">安全验证</p>
          <p
            role={error ? "alert" : "status"}
            className={`break-words text-xs leading-5 ${error ? "text-[var(--danger-ink)]" : "text-muted-foreground"}`}
          >
            {message}
          </p>
        </div>
      </div>
      {children}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={onRetry}
          className="mt-3 text-muted-foreground"
        >
          重试验证码
        </Button>
      )}
    </div>
  )
}

function TurnstileWidget({
  siteKey,
  action,
  busy,
  onVerified,
  onInvalidate,
}: TurnstileCaptchaProps & { siteKey: string }) {
  const container = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(true)
  const [measured, setMeasured] = useState(false)
  const [revision, setRevision] = useState(0)
  const [message, setMessage] = useState("正在加载验证码…")
  const [failed, setFailed] = useState(false)
  const isLight = useIsLightTheme()

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    function measure() {
      if (!element) return
      setCompact(element.getBoundingClientRect().width < 300)
      setMeasured(true)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener("resize", measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  useLayoutEffect(() => {
    onInvalidate()
  }, [compact, isLight, revision, onInvalidate])

  useEffect(() => {
    const element = container.current
    if (!element || !measured) return
    let active = true
    let accepting = true
    let widgetId: string | undefined
    let sdk: TurnstileSdk | undefined
    setFailed(false)
    setMessage("正在加载验证码…")

    function invalidate(text: string) {
      if (!active) return
      accepting = false
      onInvalidate()
      setFailed(true)
      setMessage(text)
    }
    void loadTurnstileSdk(element.ownerDocument).then(
      (loaded) => {
        if (!active) return
        sdk = loaded
        try {
          setMessage("正在验证，请稍候…")
          widgetId = loaded.render(element, {
            sitekey: siteKey,
            action,
            theme: isLight ? "light" : "dark",
            size: compact ? "compact" : "flexible",
            // 仅调整官方组件的展示时机，仍在 render 时执行验证并等待真实 token。
            appearance: "interaction-only",
            language: "zh-cn",
            "response-field": false,
            retry: "never",
            "refresh-expired": "never",
            "refresh-timeout": "never",
            callback: (token) => {
              if (!active || !accepting) return
              if (!token) return invalidate("验证码验证失败，请重试")
              onVerified(token)
              setMessage("验证已完成")
            },
            "expired-callback": () => invalidate("验证码已过期，请重新验证"),
            "error-callback": () => invalidate("验证码验证失败，请重试"),
            "timeout-callback": () => invalidate("验证码验证超时，请重试"),
            "unsupported-callback": () => invalidate("当前浏览器无法加载验证码，请重试"),
          })
          if (widgetId === undefined) invalidate("验证码组件加载失败，请重试")
        } catch {
          invalidate("验证码组件加载失败，请重试")
        }
      },
      () => invalidate("验证码组件加载失败，请重试"),
    )
    return () => {
      active = false
      accepting = false
      if (sdk && widgetId !== undefined) sdk.remove(widgetId)
    }
  }, [action, compact, isLight, measured, onInvalidate, onVerified, revision, siteKey])

  return (
    <CaptchaFeedback
      message={message}
      error={failed}
      busy={busy}
      onRetry={failed ? () => setRevision((value) => value + 1) : undefined}
    >
      <div ref={container} className="min-w-0 w-full [&:not(:empty)]:mt-3" />
    </CaptchaFeedback>
  )
}
