// 负责定义第一阶段管理后台导航和页面标题。
export interface NavItem {
  href: string
  label: string
}

/** 第一阶段只暴露用户、会员、设备和安全审计页面。 */
export const NAV: NavItem[] = [
  { href: "/users", label: "用户" },
  { href: "/membership", label: "会员" },
  { href: "/devices", label: "设备" },
  { href: "/audits", label: "安全审计" },
]

/** 根据当前 pathname 返回中文页面标题。 */
export function pageTitle(pathname: string): string {
  return NAV.find((item) => pathname.startsWith(item.href))?.label ?? "管理后台"
}
