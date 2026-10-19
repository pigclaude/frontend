// 负责管理后台真实业务入口的单一导航、分组和面包屑定义。
/** 管理入口保持真实页面地址、中文名称和搜索关键词。 */
export interface NavItem {
  href: string
  name: string
  label: string
  group: string
  kw: string
  permission?: string
}
/** 后台仅展示已经实现的四项业务。 */
export const NAV: NavItem[] = [
  {
    href: "/settings",
    name: "系统设置",
    label: "系统设置",
    group: "安全管理",
    kw: "settings shezhi security",
    permission: "settings:read",
  },
  { href: "/users", name: "用户", label: "用户", group: "运营管理", kw: "user yonghu" },
  { href: "/membership", name: "会员", label: "会员", group: "运营管理", kw: "membership huiyuan" },
  { href: "/devices", name: "设备绑定", label: "设备绑定", group: "安全管理", kw: "device shebei" },
  { href: "/audits", name: "安全审计", label: "安全审计", group: "安全管理", kw: "audit shenji" },
]
/** 导航分组顺序与侧栏保持一致。 */
export const GROUPS = ["运营管理", "安全管理"]
/** 精确解析真实页面的标题。 */
export function pageTitle(path: string) {
  return NAV.find((item) => item.href === path)?.name ?? "管理后台"
}
/** 面包屑只解析已经支持的顶级页面。 */
export function resolveCrumb(path: string) {
  return NAV.find((item) => item.href === path)?.name
}
/** 当前入口都是独立页面，不存在导航父项。 */
export function isNavParent(href: string) {
  return href === "/membership"
}
