// 负责个人中心外壳：宽屏左侧吸顶侧栏，窄屏或会员页改为顶部横向导航。
"use client"

import { Fragment, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@pigclaude/web-ui/lib/utils"
import { accountNavGroups, isAccountNavActive } from "@/components/account/account-nav-items"

function AccountNav({ variant }: { variant: "side" | "tabs" }) {
  const pathname = usePathname()
  return (
    <nav aria-label="个人中心" data-variant={variant} className="account-nav">
      {accountNavGroups.map((group) => (
        <Fragment key={group.label}>
          {variant === "side" && <span className="account-nav-group">{group.label}</span>}
          {group.items.map((item) => {
            const active = isAccountNavActive(item.href, pathname)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="account-nav-link"
              >
                <Icon aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </Fragment>
      ))}
    </nav>
  )
}

/**
 * 包住个人中心各页面并提供唯一的 `main`。默认是侧栏加内容区；`compact` 为 true 时
 * 只在内容上方放横向导航，子元素直接排进 `page-shell`，会员页的两栏布局不受影响。
 */
export function AccountShell({
  children,
  compact,
  className,
}: {
  children: ReactNode
  compact?: boolean
  className?: string
}) {
  if (compact)
    return (
      <main className={cn("page-shell account-shell", className)} data-compact="true">
        <AccountNav variant="tabs" />
        {children}
      </main>
    )
  return (
    <main className={cn("page-shell account-shell", className)}>
      <div className="account-layout">
        <AccountNav variant="side" />
        <div className="account-content">{children}</div>
      </div>
    </main>
  )
}
