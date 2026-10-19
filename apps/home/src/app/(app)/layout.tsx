// 负责受限账号区域的统一导航外壳。
import type { ReactNode } from "react"
import { Nav } from "@/components/nav"

/** 包装已登录区域，保留查询错误由各页面展示和重试。 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Nav />
      {children}
    </>
  )
}
