// 负责授权类页面底部的主次按钮，以及标记「哪个按钮正在提交」的本地状态。
"use client"
import { useState } from "react"
import { Button } from "@pigclaude/web-ui/components/button"
import { Spinner } from "@pigclaude/web-ui/components/spinner"

/**
 * 记录最近一次点击的动作；父级解除 `disabled` 后在同一次渲染中清空，
 * 因此转圈只出现在真正提交中的那个按钮上。
 */
export function usePressedAction<T extends string>(disabled: boolean) {
  const [pressed, setPressed] = useState<T | null>(null)
  if (!disabled && pressed !== null) setPressed(null)
  return [disabled ? pressed : null, setPressed] as const
}

/** 提交中显示的转圈，对读屏隐藏，不改变按钮的可访问名称。 */
export function PendingSpinner() {
  return <Spinner aria-hidden="true" role="presentation" aria-label={undefined} />
}

/**
 * 渲染主按钮和「取消」；`disabled` 时两者都不可点，
 * `primaryBlocked` 只额外锁住主按钮（例如尚未勾选确认）。
 */
export function AuthorizationActions({
  primaryLabel,
  primaryBlocked = false,
  disabled,
  busy,
  onPrimary,
  onCancel,
}: {
  primaryLabel: string
  primaryBlocked?: boolean
  disabled: boolean
  busy: "primary" | "cancel" | null
  onPrimary: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        aria-busy={busy === "primary" || undefined}
        disabled={disabled || primaryBlocked}
        onClick={onPrimary}
        className="h-9 w-full font-semibold hover:bg-[var(--btn-primary-hover)] active:bg-[var(--btn-primary-active)]"
      >
        {busy === "primary" && <PendingSpinner />}
        {primaryLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        aria-busy={busy === "cancel" || undefined}
        disabled={disabled}
        onClick={onCancel}
        className="h-9 w-full border-border bg-[var(--btn-bg)] text-foreground shadow-[var(--btn-shadow)] hover:bg-[var(--btn-bg-hover)] active:bg-[var(--raise-3)] dark:border-border dark:bg-[var(--btn-bg)] dark:hover:bg-[var(--btn-bg-hover)]"
      >
        {busy === "cancel" && <PendingSpinner />}
        取消
      </Button>
    </div>
  )
}
