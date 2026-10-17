// 负责承载会员列表页面，并链接到设备和安全审计管理页。
import { NavLink } from "react-router"
import { PageHead } from "@/components/shell/page-head"
import { TableCard } from "@/components/shell/table-card"
import { MembersSection } from "@/components/membership/members-section"

/** 管理会员授予、撤销和服务端状态查询。 */
export default function MembershipPage() {
  return (
    <>
      <PageHead title="会员" subtitle="授予和撤销会员时必须经过服务端权限与审计事务。" />
      <div className="admin-tabs" aria-label="会员管理分区">
        <NavLink to="/membership">会员列表</NavLink>
        <NavLink to="/devices">设备绑定</NavLink>
        <NavLink to="/audits">安全审计</NavLink>
      </div>
      <TableCard title="会员列表">
        <MembersSection />
      </TableCard>
    </>
  )
}
