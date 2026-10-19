// 负责本人设备管理路由，复用现有账号布局。
import { DeviceList } from "@/components/devices/device-list"
/** 设备管理独立于会员有效期，授权仍由服务端 RP 守卫。 */
export default function DevicesPage() {
  return (
    <main className="page-shell">
      <DeviceList />
    </main>
  )
}
