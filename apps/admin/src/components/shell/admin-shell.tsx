// 负责迁入 Pigcursor 成熟后台的admin-shell组件与交互，保持原有布局和语义。
import { useEffect, useRef, useState } from "react"
import { Outlet, useLocation, useNavigate } from "react-router"
import { ApiError } from "@pigclaude/api/client"
import { useQueryClient } from "@tanstack/react-query"
import { PanelLeft, Search } from "lucide-react"
import { cn } from "@pigclaude/web-ui/lib/utils"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useMediaQuery } from "@/hooks/use-media-query"
import { adminApi } from "@/lib/api"
import { toastApiError } from "@/lib/errors"
import { ThemeButton } from "../theme-button"
import { Cmdk } from "./cmdk"
import { Crumbs } from "./crumbs"
import { SideNav } from "./side-nav"
import { useMobileNavigation } from "./use-mobile-navigation"
import "./admin-shell.css"

const RAIL_KEY = "pigclaude-admin-sidebar"

/** readRail 保持后台组件的样式、可访问语义和交互契约。 */
function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "rail"
  } catch {
    return false
  }
}

/**
 * 管理后台外壳：240px 分组侧栏（桌面可折叠为 64px 图标轨，⌘B 切换，偏好存 localStorage）
 * + 56px 顶栏（侧栏开关 / 面包屑 / 快速跳转 / 主题）+ <Outlet/>。
 * ≤768px 侧栏变固定抽屉（translateX(-100%) + .side-open 滑入 + backdrop 点击/Esc/点菜单链接关闭）——
 * 用 state + 原生 div 实现（未用 Sheet）：抽屉与桌面侧栏是同一个 <aside>，只靠断点切换形态，
 * 直接状态驱动更容易保证 ≤1024/≤768 两档宽度切换与抽屉动效一致（断点数值见 admin-shell.css）。
 */
/** AdminShell 保持后台组件的样式、可访问语义和交互契约。 */
export function AdminShell() {
  const [rail, setRail] = useState(readRail)
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const isMobile = useMediaQuery("(max-width: 768px)")
  const {
    sideOpen,
    setSideOpen,
    mobileOpen,
    closeSide,
    sideRef,
    toggleRef,
    onSideKeyDown,
    restoreToggleFocus,
  } = useMobileNavigation(isMobile)
  const logoutLock = useRef(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { pathname } = useLocation()

  function toggleSidebar() {
    if (isMobile) {
      setSideOpen((v) => !v)
      return
    }
    setRail((v) => {
      try {
        localStorage.setItem(RAIL_KEY, v ? "full" : "rail")
      } catch {
        /* localStorage 不可用时只在本次会话内生效 */
      }
      return !v
    })
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        (e.key === "b" || e.key === "B") &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault()
        toggleSidebar()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  })

  async function handleLogout() {
    if (logoutLock.current) return
    logoutLock.current = true
    setLogoutPending(true)
    try {
      try {
        await adminApi.auth.logout()
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) {
          toastApiError(error)
          return
        }
      }
      await queryClient.cancelQueries()
      queryClient.clear()
      navigate("/login", { replace: true })
    } finally {
      logoutLock.current = false
      setLogoutPending(false)
    }
  }

  return (
    <TooltipProvider>
      <div className={cn("admin-shell flex min-h-dvh", mobileOpen && "side-open")}>
        <SideNav
          navigationRef={sideRef}
          onInactiveMenuClose={restoreToggleFocus}
          inactive={isMobile && !sideOpen}
          onNavigationKeyDown={onSideKeyDown}
          logoutPending={logoutPending}
          rail={rail && !isMobile}
          onNavigate={closeSide}
          onLogout={handleLogout}
          onOpenCmdk={() => {
            closeSide()
            setCmdkOpen(true)
          }}
        />
        {mobileOpen && (
          <div
            className="fixed inset-0 z-[74] hidden animate-in bg-[var(--backdrop-soft)] backdrop-blur-[2px] fade-in-0 [@media(max-width:768px)]:block"
            onClick={closeSide}
            aria-hidden="true"
          />
        )}

        <div
          className="flex min-w-0 flex-1 flex-col"
          inert={mobileOpen}
          aria-hidden={mobileOpen || undefined}
        >
          <header className="sticky top-0 z-[60] flex h-14 shrink-0 items-center gap-3 border-b border-border-soft bg-[var(--topbar-bg)] px-4 backdrop-blur-[12px] backdrop-saturate-150 md:px-6">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={toggleRef}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-expanded={isMobile ? sideOpen : !rail}
                  aria-label={isMobile ? "打开导航菜单" : rail ? "展开侧栏" : "收起侧栏"}
                  data-side-toggle
                  onClick={toggleSidebar}
                  className="-ml-1 text-muted-foreground"
                >
                  <PanelLeft className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-2">
                {rail ? "展开侧栏" : "收起侧栏"}
                <span className="text-meta">⌘B</span>
              </TooltipContent>
            </Tooltip>
            <span aria-hidden className="h-4 w-px bg-border" />

            <Crumbs />

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCmdkOpen(true)}
                aria-label="快速跳转"
                className="flex h-8 w-56 cursor-pointer items-center gap-2 rounded-md border border-border bg-raise-1 px-2.5 text-[13px] text-meta transition-colors outline-none hover:border-border-strong hover:text-fg-2 focus-visible:ring-[3px] focus-visible:ring-ring/30 max-lg:w-44 max-md:w-8 max-md:justify-center max-md:px-0"
              >
                <Search className="size-3.5 shrink-0" />
                <span className="truncate max-md:hidden">快速跳转…</span>
                <span className="ml-auto flex items-center gap-0.5 max-md:hidden">
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </span>
              </button>

              <ThemeButton />
            </div>
          </header>

          <main className="flex-1 px-4 py-6 md:px-8 md:py-7">
            <div
              key={pathname}
              className="mx-auto w-full max-w-[1600px] animate-in duration-300 fade-in-0 slide-in-from-bottom-1"
            >
              <Outlet />
            </div>
          </main>
        </div>

        <Cmdk open={cmdkOpen} onOpenChange={setCmdkOpen} />
      </div>
    </TooltipProvider>
  )
}
