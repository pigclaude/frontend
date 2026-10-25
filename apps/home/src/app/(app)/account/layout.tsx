// 负责个人中心三个页面共用的外壳，切换页面时侧栏保持不动。
import type { ReactNode } from "react"
import { AccountShell } from "@/components/account/account-shell"

/** 个人资料、登录与安全、设备管理都渲染在同一个外壳里。 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>
}
