// 负责把四个真实管理入口映射到原后台使用的图标。
import { Users, Gem, Monitor, ShieldCheck, type LucideIcon } from "lucide-react"
/** 导航图标覆盖全部已支持的后台页面。 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  "/users": Users,
  "/membership": Gem,
  "/devices": Monitor,
  "/audits": ShieldCheck,
}
