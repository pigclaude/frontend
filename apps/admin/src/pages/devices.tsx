// 负责承载设备绑定管理页面。
import { NavLink } from "react-router"
import { PageHead } from "@/components/shell/page-head"
import { TableCard } from "@/components/shell/table-card"
import { DevicesSection } from "@/components/membership/devices-section"

/** 展示当前设备绑定并提供带原因的解绑操作。 */
export default function DevicesPage() {
  return (
    <>
      <PageHead
        title="设备绑定"
        subtitle="解绑会递增 binding epoch，旧客户端由服务端在下一次校验时拒绝。"
      />
      <div className="admin-tabs">
        <NavLink to="/membership">会员列表</NavLink>
        <NavLink to="/devices">设备绑定</NavLink>
        <NavLink to="/audits">安全审计</NavLink>
      </div>
      <TableCard title="设备绑定">
        <DevicesSection />
      </TableCard>
    </>
  )
}
