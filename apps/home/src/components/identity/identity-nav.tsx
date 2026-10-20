// 负责中央身份页顶栏：只按地址中的交互 realm 决定是否在品牌旁显示「管理后台」，不读取任何 RP 会话。
"use client"
import { useSearchParams } from "next/navigation"
import { Nav } from "@/components/nav"

/** Admin realm 交互在品牌旁显示「管理后台」标记，其余交互显示普通认证顶栏。 */
export function IdentityNav() {
  const admin = useSearchParams().get("realm") === "Admin"
  return <Nav variant="auth" tag={admin ? "管理后台" : undefined} />
}
