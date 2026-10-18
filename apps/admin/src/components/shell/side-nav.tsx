// 负责迁入 Pigcursor 成熟后台的side-nav组件与交互，保持原有布局和语义。
import { useEffect, useState, type KeyboardEventHandler, type Ref } from "react"
import { Link, useLocation } from "react-router"
import { ChevronsUpDown, LogOut, Search, SunMoon } from "lucide-react"
import { cn } from "@pigclaude/web-ui/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAdminMe } from "@/hooks/use-admin-me"
import { canAdminPermission } from "@/lib/admin-permissions"
import { GROUPS, isNavParent, NAV, type NavItem } from "@/lib/nav"
import { toggleTheme } from "@pigclaude/web-ui/lib/theme"
import { BrandMark } from "./brand-mark"
import { NAV_ICONS } from "./nav-icons"

interface SideNavProps {
  /** 移动关闭时使整棵导航不可交互，并提供可见焦点边界。 */
  inactive: boolean
  navigationRef: Ref<HTMLElement>
  onInactiveMenuClose: () => void
  onNavigationKeyDown: KeyboardEventHandler<HTMLElement>
  /** 退出未完成前保持禁用，避免重复撤销。 */
  logoutPending: boolean
  /** 桌面端折叠为 64px 图标轨（移动端抽屉始终展开）。 */
  rail: boolean
  /** 点击品牌区或菜单链接后触发——移动端抽屉用它关闭自身。 */
  onNavigate: () => void
  onLogout: () => void
  onOpenCmdk: () => void
}

/** SideNav 保持后台组件的样式、可访问语义和交互契约。 */
export function SideNav({
  rail,
  onNavigate,
  onLogout,
  onOpenCmdk,
  inactive,
  navigationRef,
  onInactiveMenuClose,
  onNavigationKeyDown,
  logoutPending,
}: SideNavProps) {
  const { pathname } = useLocation()
  const { data: me } = useAdminMe()

  return (
    <aside
      ref={navigationRef}
      inert={inactive}
      aria-hidden={inactive || undefined}
      onKeyDown={onNavigationKeyDown}
      aria-label="管理后台导航"
      data-rail={rail}
      className="admin-side flex flex-col border-r border-border-soft bg-panel"
    >
      <div className={cn("flex h-14 shrink-0 items-center px-4", rail && "justify-center px-0")}>
        <Link
          to="/users"
          aria-label="pigclaude 管理后台首页"
          onClick={onNavigate}
          className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
        >
          <BrandMark />
          {!rail && (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-[18px] font-semibold tracking-[-0.02em] text-foreground">
                PigClaude
              </span>
              <span className="text-[11px] text-meta">管理后台</span>
            </span>
          )}
        </Link>
      </div>

      <nav
        className={cn(
          "flex flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-3 pt-2 pb-4",
          rail && "gap-3 px-0",
        )}
      >
        {GROUPS.map((group, index) => (
          <div key={group} className="flex flex-col gap-0.5">
            {rail ? (
              index > 0 && <span aria-hidden className="mx-auto mb-2 h-px w-6 bg-border" />
            ) : (
              <span className="px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.02em] text-meta">
                {group}
              </span>
            )}
            {NAV.filter(
              (item) =>
                item.group === group &&
                (!item.permission ||
                  (me?.status === "active" &&
                    canAdminPermission(me.permissions ?? [], item.permission))),
            ).map((item) => (
              <NavEntry
                key={item.href}
                item={item}
                rail={rail}
                active={
                  isNavParent(item.href)
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`)
                }
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className={cn("shrink-0 border-t border-border-soft p-3", rail && "px-0")}>
        <UserMenu
          rail={rail}
          inactive={inactive}
          onInactiveMenuClose={onInactiveMenuClose}
          logoutPending={logoutPending}
          onLogout={onLogout}
          onOpenCmdk={onOpenCmdk}
        />
      </div>
    </aside>
  )
}

/** NavEntry 保持后台组件的样式、可访问语义和交互契约。 */
function NavEntry({
  item,
  rail,
  active,
  onNavigate,
}: {
  item: NavItem
  rail: boolean
  active: boolean
  onNavigate: () => void
}) {
  const Icon = NAV_ICONS[item.href]
  // 不用 NavLink：Tooltip 的 asChild(Slot) 会把函数式 className 拼成字符串，这里自行判定 active。
  const link = (
    <Link
      to={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? item.name : undefined}
      className={cn(
        "group/nav relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-fg-2 transition-[background-color,color] duration-150 outline-none hover:bg-raise-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30",
        rail && "mx-auto size-9 justify-center px-0",
        active &&
          "bg-[var(--nav-active)] text-foreground shadow-[var(--nav-active-shadow)] hover:bg-[var(--nav-active)]",
      )}
    >
      {active && (
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary",
            rail ? "-left-[14px]" : "-left-3",
          )}
        />
      )}
      <Icon
        className={cn(
          "size-4 shrink-0 text-meta transition-colors group-hover/nav:text-fg-2",
          active && "text-accent-ink group-hover/nav:text-accent-ink",
        )}
      />
      {!rail && <span className="truncate">{item.name}</span>}
    </Link>
  )

  if (!rail) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.name}</TooltipContent>
    </Tooltip>
  )
}

/** UserMenu 保持后台组件的样式、可访问语义和交互契约。 */
function UserMenu({
  rail,
  onInactiveMenuClose,
  inactive,
  logoutPending,
  onLogout,
  onOpenCmdk,
}: {
  rail: boolean
  inactive: boolean
  onInactiveMenuClose: () => void
  logoutPending: boolean
  onLogout: () => void
  onOpenCmdk: () => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (inactive) setOpen(false)
  }, [inactive])
  const { data: me } = useAdminMe()
  const account = me?.account ?? ""
  const initial = (account || "?").slice(0, 1).toUpperCase()

  return (
    <DropdownMenu open={!inactive && open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="账号菜单"
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 rounded-md p-1.5 text-left transition-colors outline-none hover:bg-raise-2 focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=open]:bg-raise-2",
            rail && "mx-auto size-10 w-10 justify-center p-0",
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-raise-3 text-xs font-semibold text-foreground">
            {initial}
          </span>
          {!rail && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {account}
                </span>
                <span className="block text-[11px] text-meta">管理员</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-meta" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        onCloseAutoFocus={(event) => {
          // 抽屉已关闭时，焦点由外壳归还可见开关，不能再回到屏外账号按钮。
          if (inactive) {
            event.preventDefault()
            onInactiveMenuClose()
          }
        }}
        side={rail ? "right" : "top"}
        align={rail ? "end" : "start"}
        className={rail ? undefined : "w-(--radix-dropdown-menu-trigger-width)"}
      >
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">{account}</span>
          <span className="font-normal">pigclaude 管理后台</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenCmdk}>
          <Search />
          快速跳转
          <DropdownMenuShortcut>⌘K</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleTheme}>
          <SunMoon />
          切换明暗主题
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={logoutPending} onSelect={onLogout}>
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
