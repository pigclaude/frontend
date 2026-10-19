// 负责迁入 Pigcursor 成熟后台的crumbs组件与交互，保持原有布局和语义。
import { useLocation } from "react-router"
import { ChevronRight } from "lucide-react"
import { NAV, resolveCrumb } from "@/lib/nav"
import { NAV_ICONS } from "./nav-icons"

/**
 * 面包屑「{分组} › {当前页}」：resolveCrumb 精确匹配顶级路由（NAV 单一事实源），
 * 未知路径只显示「管理后台」；≤768px 只留当前页名。
 */
/** Crumbs 保持后台组件的样式、可访问语义和交互契约。 */
export function Crumbs() {
  const { pathname } = useLocation()
  const current = resolveCrumb(pathname)
  const item = NAV.find((n) => n.href === pathname)
  const Icon = item ? NAV_ICONS[item.href] : null

  return (
    <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className="text-meta max-md:hidden">{item?.group ?? "管理后台"}</span>
      {current && (
        <>
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-meta opacity-70 max-md:hidden"
          />
          <strong className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            {Icon && <Icon className="size-3.5 shrink-0 text-meta" />}
            <span className="truncate">{current}</span>
          </strong>
        </>
      )}
    </nav>
  )
}
