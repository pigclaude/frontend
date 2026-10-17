// 负责提供本文件的前端契约、组件或样式实现。
"use client"

import * as React from "react"
import GoCaptcha from "go-captcha-react"

import { cn } from "@pigclaude/web-ui/lib/utils"

// 出题数据（结构与 @pigclaude/api CaptchaChallenge 一致，此处本地声明避免 ui→api 反向依赖）。
export interface SliderChallenge {
  captchaKey: string
  masterImage: string
  tileImage: string
  tileWidth: number
  tileHeight: number
  tileX: number
  tileY: number
  /** 仅测试环境（PIGCURSOR_CAPTCHA_DEBUG=1）下非空，供 e2e 自动滑动 */
  debugX?: number
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export interface SliderCaptchaLabels {
  /** 拼图上方操作提示（同时下传给 go-captcha-react）。 */
  title: string
  loadError: string
  retry: string
  loading: string
}

const DEFAULT_LABELS: SliderCaptchaLabels = {
  title: "请拖动滑块完成拼图",
  loadError: "验证码加载失败",
  retry: "重试",
  loading: "验证码加载中",
}

/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export interface SliderCaptchaProps {
  /** 出题：返回一道滑动题；抛错时组件展示重试 */
  generate: () => Promise<SliderChallenge>
  /** 校验滑动落点 x，返回一次性 captchaToken（失败请 reject） */
  verify: (captchaKey: string, x: number) => Promise<string>
  /** 校验通过：把 token 交给父表单（父在提交时携带，后端消费即焚） */
  onVerified: (token: string) => void
  /** token 需失效（重滑/刷新/校验失败）时通知父组件清空已持有 token */
  onInvalidate?: () => void
  /** 判定 generate 错误是否为「验证码已关闭」（由 app 层传入，避免 ui 依赖 @pigclaude/api 的 ApiError） */
  isDisabled?: (e: unknown) => boolean
  /** 检测到验证码关闭时回调（父据此放开提交、不再要求 token）；组件自身渲染 null */
  onDisabled?: () => void
  /** 由应用 i18n 层注入；Admin 中文单语可省略并使用默认文案。 */
  labels?: SliderCaptchaLabels
  className?: string
}

type Status = "loading" | "ready" | "verifying" | "passed" | "error" | "disabled"

/**
 * 滑块验证码（go-captcha-react 滑动模式的主题化封装）。挂载即出题；滑动确认后调 verify 换
 * captchaToken 经 onVerified 上抛。校验失败/刷新会 onInvalidate 通知父组件清空旧 token。
 * 图片为 base64 dataURL，直接喂给 GoCaptcha.Slide 的 image/thumb。
 */
/** 对外导出该模块能力，保证调用方使用稳定的类型或函数契约。 */
export function SliderCaptcha({
  generate,
  verify,
  onVerified,
  onInvalidate,
  isDisabled,
  onDisabled,
  labels = DEFAULT_LABELS,
  className,
}: SliderCaptchaProps) {
  const [challenge, setChallenge] = React.useState<SliderChallenge | null>(null)
  const [status, setStatus] = React.useState<Status>("loading")
  const captchaRef = React.useRef<{ reset: () => void; refresh: () => void } | null>(null)
  // 防竞态：仅最后一次 load 的结果被采用（快速刷新时旧请求返回不覆盖新题）。
  const loadSeq = React.useRef(0)

  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current
    setStatus("loading")
    onInvalidate?.()
    try {
      const c = await generate()
      if (seq !== loadSeq.current) return
      setChallenge(c)
      setStatus("ready")
    } catch (e) {
      if (seq !== loadSeq.current) return
      // 验证码总开关关闭：不渲染滑块，通知父组件放开提交（后端也会跳过 token 校验）。
      if (isDisabled?.(e)) {
        setStatus("disabled")
        onDisabled?.()
        return
      }
      setStatus("error")
    }
  }, [generate, onInvalidate, isDisabled, onDisabled])

  React.useEffect(() => {
    void load()
    // 仅挂载时出题一次；后续由用户刷新/失败触发 load。
  }, [])

  const handleConfirm = React.useCallback(
    (point: { x: number; y: number }, reset: () => void) => {
      if (!challenge || status === "verifying") return
      setStatus("verifying")
      verify(challenge.captchaKey, point.x)
        .then((token) => {
          setStatus("passed")
          onVerified(token)
        })
        .catch(() => {
          // 校验失败：清空父 token、复位滑块并换新题（防止用同一图暴力试位置）。
          onInvalidate?.()
          reset()
          setStatus("ready")
          void load()
        })
    },
    [challenge, status, verify, onVerified, onInvalidate, load],
  )

  if (status === "disabled") return null

  if (status === "error") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <span>{labels.loadError}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="font-medium text-primary hover:underline"
        >
          {labels.retry}
        </button>
      </div>
    )
  }

  if (!challenge) {
    return (
      <div
        className={cn(
          "h-[172px] w-full animate-pulse rounded-md border border-border bg-muted/40",
          className,
        )}
        aria-label={labels.loading}
      />
    )
  }

  return (
    <div
      className={cn(
        "gocaptcha-box",
        status === "passed" && "pointer-events-none opacity-90",
        className,
      )}
    >
      <GoCaptcha.Slide
        ref={captchaRef as never}
        config={{ width: 300, height: 240, showTheme: false, title: labels.title }}
        data={{
          image: challenge.masterImage,
          thumb: challenge.tileImage,
          thumbX: challenge.tileX,
          thumbY: challenge.tileY,
          thumbWidth: challenge.tileWidth,
          thumbHeight: challenge.tileHeight,
        }}
        events={{
          refresh: () => void load(),
          confirm: handleConfirm,
        }}
      />
    </div>
  )
}
