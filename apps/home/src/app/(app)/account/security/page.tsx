// 负责登录与安全页路由；页面内容在后续任务中补齐。
import { AccountPageHeader } from "@/components/account/account-page-header"

/** 登录与安全占位页，只显示标题。 */
export default function AccountSecurityPage() {
  return <AccountPageHeader title="登录与安全" subtitle="你用来登录的邮箱、密码和第三方账号。" />
}
