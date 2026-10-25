// 负责个人中心唯一的路由与标题表，侧栏、横向导航和头像菜单都从这里取。
import type { LucideIcon } from "lucide-react"
import { Gem, LockKeyhole, Monitor, UserRound } from "lucide-react"

/** 个人中心的一个导航项。 */
export interface AccountNavItem {
  href: string
  label: string
  icon: LucideIcon
}

/** 侧栏分组：「账户」三项和「订阅」一项，顺序即展示顺序。 */
export const accountNavGroups: readonly { label: string; items: readonly AccountNavItem[] }[] = [
  {
    label: "账户",
    items: [
      { href: "/account", label: "个人资料", icon: UserRound },
      { href: "/account/security", label: "登录与安全", icon: LockKeyhole },
      { href: "/account/devices", label: "设备管理", icon: Monitor },
    ],
  },
  { label: "订阅", items: [{ href: "/membership", label: "会员", icon: Gem }] },
]

/** 判断导航项是否对应当前地址：个人资料只匹配 `/account` 本身，其余也匹配子路径。 */
export function isAccountNavActive(href: string, pathname: string): boolean {
  if (href === "/account") return pathname === "/account"
  return pathname === href || pathname.startsWith(`${href}/`)
}
