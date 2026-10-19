// 负责以原后台标签页组件导航会员、设备与安全审计的真实页面。
import type { ReactNode } from "react"
import { useLocation, useNavigate } from "react-router"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/** 保留标签键盘语义，同时让当前分区与真实 URL 同步。 */
export function MembershipSections({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <Tabs value={pathname} onValueChange={(path) => navigate(path)}>
      <TabsList aria-label="会员管理分区">
        <TabsTrigger value="/membership">会员列表</TabsTrigger>
        <TabsTrigger value="/devices">设备绑定</TabsTrigger>
        <TabsTrigger value="/audits">安全审计</TabsTrigger>
      </TabsList>
      <TabsContent value={pathname}>{children}</TabsContent>
    </Tabs>
  )
}
