// 负责承载设备绑定页面，复用成熟后台的页头、分区导航和数据卡片。
import { MembershipSections } from "@/components/membership/membership-sections"
import { PageHead } from "@/components/shell/page-head"
import { DevicesSection } from "@/components/membership/devices-section"

/** 展示设备绑定的真实业务操作与状态。 */
export default function DevicesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHead title="设备绑定" subtitle="按账号查看多台设备，并在需要时撤销指定授权关系。" />
      <MembershipSections>
        <DevicesSection />
      </MembershipSections>
    </div>
  )
}
