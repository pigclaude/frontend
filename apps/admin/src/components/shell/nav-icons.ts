// 负责把四个真实管理入口映射到原后台使用的图标。
import { Users, Gem, Monitor, ShieldCheck, Settings2 } from "lucide-react"
import type { ComponentType, ComponentProps } from "react"
import { TiersIcon, OrdersIcon } from "@/components/icon"
/** 导航图标覆盖全部已支持的后台页面。 */
export const NAV_ICONS: Record<string, ComponentType<ComponentProps<"svg">>> = {
  "/tiers": TiersIcon,
  "/orders": OrdersIcon,
  "/users": Users,
  "/membership": Gem,
  "/devices": Monitor,
  "/audits": ShieldCheck,
  "/settings": Settings2,
}
