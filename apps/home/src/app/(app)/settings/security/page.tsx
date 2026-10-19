// 负责登录方式设置路由，真实授权与近期证明由受保护 API 决定。
import { Suspense } from "react"
import { LinkedIdentities } from "@/components/identity/linked-identities"
/** 在现有账号布局内显示登录方式列表与近期核验。 */
export default function SecurityPage() {
  return (
    <main className="page-shell">
      <Suspense>
        <LinkedIdentities />
      </Suspense>
    </main>
  )
}
