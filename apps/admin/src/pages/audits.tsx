// 负责承载不可变安全审计页面。
import { NavLink } from "react-router"
import { PageHead } from "@/components/shell/page-head"
import { TableCard } from "@/components/shell/table-card"
import { AuditsSection } from "@/components/membership/audits-section"

/** 展示管理员会员和设备操作的审计记录。 */
export default function AuditsPage() {
  return (
    <>
      <PageHead title="安全审计" subtitle="审计记录由服务端写入，不允许页面伪造或覆盖。" />
      <div className="admin-tabs">
        <NavLink to="/membership">会员列表</NavLink>
        <NavLink to="/devices">设备绑定</NavLink>
        <NavLink to="/audits">安全审计</NavLink>
      </div>
      <TableCard title="安全审计">
        <AuditsSection />
      </TableCard>
    </>
  )
}
