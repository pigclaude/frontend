// 负责为中央身份交互提供公开页面与 Suspense 边界。
import { Suspense } from "react"
import { InteractionPanel } from "@/components/identity/interaction-panel"
/** 中央页面不挂载 Home 业务会话守卫。 */
export default function IdentityPage() {
  return (
    <Suspense fallback={<p role="status">加载中…</p>}>
      <InteractionPanel />
    </Suspense>
  )
}
