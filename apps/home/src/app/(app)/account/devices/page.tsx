// 负责设备管理页路由；页面内容在后续任务中补齐。
import { AccountPageHeader } from "@/components/account/account-page-header"

/** 设备管理占位页，只显示标题。 */
export default function AccountDevicesPage() {
  return (
    <AccountPageHeader
      title="设备管理"
      subtitle="登录过你账号的电脑和浏览器。看到不认识的，移除它即可。"
    />
  )
}
