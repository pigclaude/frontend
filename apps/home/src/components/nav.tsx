// 负责迁入 Pigcursor 56px 吸顶顶栏、认证简化顶栏和可访问移动菜单。
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { homeApi } from "@/lib/api"
import { isTransientSessionError } from "@/lib/auth-query"
import { Menu } from "lucide-react"
import { Badge } from "@pigclaude/web-ui/components/badge"
import { Button } from "@pigclaude/web-ui/components/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@pigclaude/web-ui/components/sheet"
import { cn } from "@pigclaude/web-ui/lib/utils"
import { BrandMark } from "@/components/brand-mark"
import { UserMenu } from "@/components/user-menu"
import { AccentPicker } from "@pigclaude/web-ui/components/accent-picker"
import { ThemeToggle } from "@/components/theme-toggle"

const accountLinks = [
  { href: "/dashboard", label: "账户" },
  { href: "/membership", label: "会员" },
]
const marketingLinks = [
  { href: "/#product", label: "产品" },
  { href: "/#workflow", label: "使用流程" },
  { href: "/#pricing", label: "会员权益" },
]

/** 按当前路由呈现成熟原站顶栏，未实现的业务入口不出现；`tag` 紧贴品牌显示站点标记。 */
export function Nav({
  variant = "app",
  tag,
}: {
  variant?: "marketing" | "app" | "auth"
  tag?: string
}) {
  const pathname = usePathname()
  const session = useQuery({
    queryKey: ["me"],
    queryFn: homeApi.user.me,
    enabled: variant !== "auth",
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileNav = useRef<HTMLElement>(null)
  const closedByLink = useRef(false)
  const links = variant === "marketing" ? marketingLinks : accountLinks
  function closeFromLink() {
    closedByLink.current = true
    setMobileOpen(false)
  }
  useEffect(() => {
    if (!mobileOpen || typeof window.matchMedia !== "function") return
    const desktop = window.matchMedia("(min-width: 48rem)")
    const close = () => {
      if (desktop.matches) setMobileOpen(false)
    }
    close()
    desktop.addEventListener("change", close)
    return () => desktop.removeEventListener("change", close)
  }, [mobileOpen])
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border-soft)] bg-[var(--topbar-bg)] backdrop-blur-[12px]">
      <div className="mx-auto flex h-[56px] max-w-[var(--container-max)] items-center gap-[var(--space-6)] px-[var(--container-gutter-desktop)]">
        <div className="flex shrink-0 items-center gap-2.5">
          <Link
            href={variant === "app" ? "/dashboard" : "/"}
            className="inline-flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-foreground"
          >
            <BrandMark className="size-[26px] shrink-0" tone="brand" />
            <span>PigClaude</span>
          </Link>
          {tag && (
            <Badge
              variant="outline"
              className="border-border px-2 font-normal text-muted-foreground"
            >
              {tag}
            </Badge>
          )}
        </div>
        {variant === "auth" ? (
          <div className="ml-auto flex items-center gap-2">
            <AccentPicker />
            <ThemeToggle />
            <Button asChild variant="outline" size="sm">
              <Link href="/">返回官网</Link>
            </Button>
          </div>
        ) : (
          <>
            <nav aria-label="主导航" className="mx-auto hidden items-center gap-1 md:flex">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent-ui hover:text-foreground",
                    pathname === link.href && "bg-[var(--raise-2)] text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-[var(--space-3)]">
              {session.isPending ? (
                <span
                  aria-label="正在读取会话"
                  aria-busy="true"
                  className="h-8 w-20 animate-pulse rounded-md bg-muted"
                />
              ) : session.data ? (
                <UserMenu user={session.data} />
              ) : isTransientSessionError(session.error) ? (
                // 会话暂时无法确认时不冒充未登录，给出重试入口而不是留空。
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={session.isFetching}
                  onClick={() => void session.refetch()}
                >
                  {session.isFetching ? "连接中…" : "重新连接"}
                </Button>
              ) : (
                <>
                  <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
                    <Link href="/login">登录</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href="/register">创建账户</Link>
                  </Button>
                </>
              )}
              <AccentPicker />
              <ThemeToggle />
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="打开菜单"
                    className="size-[30px] rounded-full border border-border bg-[var(--raise-1)] md:hidden"
                  >
                    <Menu className="size-[14px]" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="top"
                  showCloseButton={false}
                  className="top-[56px] max-h-[calc(100dvh-56px)] gap-0 overflow-y-auto border-[var(--border-soft)] bg-[var(--bg)] px-[var(--container-gutter-desktop)] py-2 shadow-(--topbar-shadow) md:hidden [:root[data-theme=light]_&]:bg-[var(--surface)]"
                  onOpenAutoFocus={(event) => {
                    const first = mobileNav.current?.querySelector<HTMLElement>("a")
                    if (first) {
                      event.preventDefault()
                      first.focus()
                    }
                  }}
                  onCloseAutoFocus={(event) => {
                    if (closedByLink.current) {
                      event.preventDefault()
                      closedByLink.current = false
                    }
                  }}
                >
                  <SheetTitle className="sr-only">主菜单</SheetTitle>
                  <nav ref={mobileNav} aria-label="移动主导航" className="flex flex-col gap-0.5">
                    {[
                      ...links,
                      ...(session.data
                        ? accountLinks.filter(
                            (link) => !links.some((existing) => existing.href === link.href),
                          )
                        : [{ href: "/login", label: "登录 / 注册" }]),
                    ].map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeFromLink}
                        className="flex min-h-11 items-center rounded-md px-3 text-[15px] font-medium text-foreground/85 hover:bg-accent-ui"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
