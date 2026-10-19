// 负责迁入 Pigcursor 用户头像和磨砂菜单，并连接真实退出及脱敏账户摘要。
"use client"

import { useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { CircleUserRound, LogOut, ShieldCheck } from "lucide-react"
import type { MeResponse } from "@pigclaude/api/home/types"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pigclaude/web-ui/components/dropdown-menu"
import { homeApi } from "@/lib/api"
import { maskEmail, maskUserId } from "@/lib/identity-mask"
import { useHomeSessionActions } from "@/components/home-session-context"

/** 沿用原站菜单结构，仅提供真实账户/会员入口和可重试、不可重复提交的退出。 */
export function UserMenu({ user }: { user: MeResponse }) {
  const { completeLogout } = useHomeSessionActions()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const pendingRef = useRef(false)
  const generation = useRef(0)
  useLayoutEffect(() => {
    generation.current++
    return () => {
      generation.current++
    }
  }, [])
  const initial = user.nickname?.slice(0, 1) || "P"

  async function handleLogout() {
    if (pendingRef.current) return
    const current = generation.current
    pendingRef.current = true
    setPending(true)
    setError(false)
    try {
      await homeApi.auth.logout(() => current === generation.current)
      if (current === generation.current) await completeLogout()
    } catch {
      if (current !== generation.current) return
      setError(true)
      setPending(false)
      pendingRef.current = false
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="用户菜单"
        className="flex size-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-[var(--raise-3)] text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initial}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 border-[var(--border-soft)] bg-[var(--topbar-bg)] backdrop-blur-[12px]"
      >
        <div className="flex items-center gap-2.5 px-2 py-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-[var(--raise-3)] text-sm font-semibold text-foreground">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {user.nickname || "PigClaude 用户"}
            </p>
            <p className="truncate text-xs text-muted-foreground">{maskEmail(user.email)}</p>
          </div>
        </div>
        <div className="mx-1 mb-1 flex items-center justify-between rounded-md border border-[var(--border-soft)] bg-[var(--raise-1)] px-3 py-2.5">
          <span className="text-xs text-muted-foreground">用户 ID</span>
          <span className="font-mono text-[15px] font-medium text-foreground">
            {maskUserId(user.id)}
          </span>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild disabled={pending}>
          <Link href="/dashboard">
            <CircleUserRound />
            账户
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild disabled={pending}>
          <Link href="/membership">
            <ShieldCheck />
            会员
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild disabled={pending}>
          <Link href="/settings/security">
            <ShieldCheck />
            登录方式
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {error && (
          <p role="alert" className="px-2 py-2 text-xs text-[var(--danger-ink)]">
            退出失败，请重试。
          </p>
        )}
        <DropdownMenuItem
          aria-label="退出登录"
          aria-busy={pending}
          variant="destructive"
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault()
            void handleLogout()
          }}
        >
          <LogOut />
          {pending ? "退出中…" : "退出登录"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
