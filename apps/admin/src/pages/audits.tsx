// 负责承载安全审计页面，复用成熟后台的页头、分区导航和数据卡片。
import { MembershipSections } from "@/components/membership/membership-sections"
import { PageHead } from "@/components/shell/page-head"
import { AuditsSection } from "@/components/membership/audits-section"

/** 展示安全审计的真实业务操作与状态。 */
export default function AuditsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="安全审计" subtitle="按用户和事件类型查询会员与设备操作记录。" />
      <MembershipSections>
        <AuditsSection />
      </MembershipSections>
    </div>
  )
}
