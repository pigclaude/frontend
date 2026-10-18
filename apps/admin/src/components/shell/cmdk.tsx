// 负责迁入 Pigcursor 成熟后台的cmdk组件与交互，保持原有布局和语义。
import { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { Command as CommandPrimitive } from "cmdk"
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { GROUPS, NAV } from "@/lib/nav"
import { NAV_ICONS } from "./nav-icons"

interface CmdkPage {
  href: string
  name: string
  group: string
  kw: string
  icon: LucideIcon
  action?: () => void
}

interface CmdkProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * ⌘K 快速跳转。数据只包含当前真实支持的四个 NAV 页面，按侧栏分组展示。过滤语义：
 * `name.includes(原样 q) || kw.includes(q.toLowerCase())`，空查询显示全部——用
 * shouldFilter={false} 关掉 cmdk 自带的模糊评分，自己控制结果集，
 * 但仍交给 cmdk（loop）管理 ↑↓ 循环选中 / Enter 执行 / Esc 关闭。
 */
/** Cmdk 保持后台组件的样式、可访问语义和交互契约。 */
export function Cmdk({ open, onOpenChange }: CmdkProps) {
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const pages: CmdkPage[] = NAV.map((item) => ({ ...item, icon: NAV_ICONS[item.href] }))

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const q = query.trim()
  const filtered = q
    ? pages.filter((p) => p.name.includes(q) || p.kw.includes(q.toLowerCase()))
    : pages
  const groups = GROUPS.map((group) => ({
    group,
    items: filtered.filter((p) => p.group === group),
  }))

  function runItem(item: CmdkPage) {
    onOpenChange(false)
    if (item.action) {
      item.action()
    } else {
      navigate(item.href)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[14%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[560px]"
      >
        <DialogTitle className="sr-only">快速跳转</DialogTitle>
        <DialogDescription className="sr-only">搜索并跳转到管理后台页面</DialogDescription>
        <CommandPrimitive loop shouldFilter={false} className="flex min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b border-border-soft px-4">
            <Search className="size-4 shrink-0 text-meta" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="跳转到页面…"
              className="h-13 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-meta"
            />
            <Kbd>Esc</Kbd>
          </div>
          <CommandPrimitive.List className="max-h-[min(420px,60dvh)] scroll-py-2 overflow-y-auto p-2">
            <CommandPrimitive.Empty className="py-12 text-center text-[13px] text-meta">
              没有匹配的页面
            </CommandPrimitive.Empty>
            {groups.map(
              ({ group, items }) =>
                items.length > 0 && (
                  <CommandPrimitive.Group
                    key={group}
                    heading={group}
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-meta"
                  >
                    {items.map((item) => {
                      const Icon = item.icon
                      return (
                        <CommandPrimitive.Item
                          key={item.name}
                          value={item.name}
                          onSelect={() => runItem(item)}
                          className="group flex h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-[13px] text-fg-2 outline-none data-[selected=true]:bg-raise-3 data-[selected=true]:text-foreground"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-raise-2 text-meta group-data-[selected=true]:text-foreground">
                            <Icon className="size-3.5" />
                          </span>
                          <span className="truncate">{item.name}</span>
                          {item.href === pathname && <Badge variant="accent">当前页</Badge>}
                          <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-meta opacity-0 group-data-[selected=true]:opacity-100" />
                        </CommandPrimitive.Item>
                      )
                    })}
                  </CommandPrimitive.Group>
                ),
            )}
          </CommandPrimitive.List>
          <div className="flex items-center gap-4 border-t border-border-soft bg-popover px-4 py-2.5 text-[11px] text-meta">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              选择
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd>
              跳转
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
              随时唤起
            </span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}
