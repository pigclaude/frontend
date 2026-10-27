// 负责保护显式授权流程，并在空闲时选择欢迎入口或真实状态恢复页面。
import type { MembershipView } from "@pigclaude/contracts/membership"
import { LoginScreen, type LoginScreenProps } from "./login-screen"
import { RecoveryScreen } from "./recovery-screen"

/** 入口只消费脱敏视图，会员结果仍由 App 按版本归并。 */
export type DesktopEntryScreenProps = LoginScreenProps & {
  membership: MembershipView
  preview: boolean
  onMembership: (view: MembershipView) => void
}
/** 显式授权、退出与重试始终优先，后台状态不能切换掉正在进行的流程。 */
export function DesktopEntryScreen({
  membership,
  preview,
  onMembership,
  ...login
}: DesktopEntryScreenProps) {
  if (
    preview ||
    login.state.view !== "idle" ||
    login.signingOut ||
    login.onRetrySignOut ||
    membership.state === "signed_out"
  )
    return <LoginScreen {...login} />
  async function inspect() {
    const inspect = window.pigclaude?.membership?.inspect
    if (!inspect) throw new Error("MEMBERSHIP_SERVICE_UNAVAILABLE")
    const result = await inspect()
    if (result) onMembership(result)
  }
  return (
    <RecoveryScreen
      membership={membership}
      onCheck={inspect}
      onAuthorize={login.onAuthorize}
      canWithdraw={membership.recovery?.canRevoke ?? login.canWithdraw}
    />
  )
}
