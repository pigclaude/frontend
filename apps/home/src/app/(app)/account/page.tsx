// 负责个人资料页路由；页面内容在后续任务中补齐。
import { AccountPageHeader } from "@/components/account/account-page-header"

/** 个人资料占位页，只显示标题。 */
export default function AccountProfilePage() {
  return <AccountPageHeader title="个人资料" subtitle="别人看到的你，以及账号的基本信息。" />
}
