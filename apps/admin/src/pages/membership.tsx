// 负责承载会员页面，复用成熟后台的页头、分区导航和数据卡片。
import { useLocation } from "react-router"
import { useAdminMe } from "@/hooks/use-admin-me"
import { canAdminPermission } from "@/lib/admin-permissions"
import { MembershipSections } from "@/components/membership/membership-sections"
import { PageHead } from "@/components/shell/page-head"
import { MembersSection } from "@/components/membership/members-section"

/** 展示会员的真实业务操作与状态。 */
export default function MembershipPage() {
  const { data: me } = useAdminMe()
  const location = useLocation()
  const canRead =
    me?.status === "active" && canAdminPermission(me.permissions ?? [], "membership:read")
  const canWrite = canRead && canAdminPermission(me?.permissions ?? [], "membership:write")
  if (!canRead) return <p>没有查看会员的权限</p>
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="会员" subtitle="查看会员状态与授权期限，处理人工授予和撤销。" />
      <MembershipSections>
        <MembersSection key={JSON.stringify([me?.id, location.key])} canWrite={canWrite} />
      </MembershipSections>
    </div>
  )
}
