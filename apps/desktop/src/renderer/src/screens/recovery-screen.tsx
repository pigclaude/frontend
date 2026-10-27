// 负责按可信事实解释会员、设备授权和临时故障，保持无卡片居中布局。
import { useRef, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { LoginIntent } from "../models/login-model"
import { SigninPanel } from "../components/signin-panel"
import { TrafficLights } from "../components/traffic-lights"
import { WithdrawAuthorization } from "../components/withdraw-authorization"
import { Button } from "../components/ui/button"
import { Icon } from "../components/icon"

/** 恢复页面只调用受限动作，账号与设备身份不作为动作参数传出。 */
export type RecoveryScreenProps = {
  membership: MembershipView
  onCheck: () => Promise<void>
  onAuthorize: (intent: LoginIntent) => void
  onOpenWebsite?: () => Promise<void>
  canWithdraw?: boolean
}
/** 展示当前账号的可信状态，未知错误不引导续费，历史等级明确标注。 */
export function RecoveryScreen({
  membership: view,
  onCheck,
  onAuthorize,
  canWithdraw,
  onOpenWebsite,
}: RecoveryScreenProps) {
  const [checking, setChecking] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const info = presentation(view)
  const account = view.account
  const accountVisible = Boolean(account?.nickname || account?.email)
  const activeMembership = view.recovery?.status === "active" || view.state === "active"
  async function check() {
    if (pending.current) return
    pending.current = true
    setChecking(true)
    setError(null)
    try {
      await onCheck()
    } catch {
      setError("检查未完成，请稍后重试。")
    } finally {
      pending.current = false
      setChecking(false)
    }
  }
  async function openWebsite() {
    if (pending.current || !onOpenWebsite) return
    pending.current = true
    setOpening(true)
    setError(null)
    try {
      await onOpenWebsite()
    } catch {
      setError("网站未能打开，请重新检查后再试。")
    } finally {
      pending.current = false
      setOpening(false)
    }
  }
  const date =
    view.membershipValidUntil && Number.isFinite(Date.parse(view.membershipValidUntil))
      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(view.membershipValidUntil),
        )
      : null
  return (
    <div className="win">
      <div className="win-top">
        <TrafficLights />
      </div>
      <main className="win-body signin-body">
        <SigninPanel
          icon={info.busy ? "spinner" : "snout"}
          busy={info.busy}
          title={info.title}
          sub={info.sub}
        >
          {accountVisible && (
            <div className="recovery-account">
              <span className="recovery-label">当前账号</span>
              {account?.nickname && <strong>{account.nickname}</strong>}
              {account?.email && <span>{account.email}</span>}
            </div>
          )}
          {account && (view.tier || date) && (
            <div className="recovery-membership">
              {view.tier && (
                <span>
                  {activeMembership ? "会员：" : "上次会员："}
                  {view.tier.name}
                </span>
              )}
              {date && (
                <span>
                  {view.state === "expired"
                    ? "到期时间："
                    : activeMembership
                      ? "有效期至："
                      : "原有效期至："}
                  {date}
                </span>
              )}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          {!info.busy && (
            <div className="signin-actions">
              {info.website && onOpenWebsite && (
                <Button
                  variant={info.website === "查看会员" ? "ghost" : "primary"}
                  size="block"
                  disabled={checking || opening}
                  onClick={() => void openWebsite()}
                >
                  {opening ? "正在打开网站…" : info.website}
                </Button>
              )}
              <Button
                variant={
                  info.website && onOpenWebsite && info.website !== "查看会员" ? "ghost" : "primary"
                }
                size="block"
                disabled={checking || opening}
                onClick={() => (info.authorize ? onAuthorize("login") : void check())}
              >
                {checking ? "正在检查…" : info.authorize ? "重新授权" : "重新检查"}
              </Button>
              <Button
                variant="ghost"
                size="block"
                disabled={checking || opening}
                onClick={() => onAuthorize("switch")}
              >
                切换账号
              </Button>
              {info.authorize && (
                <Button
                  variant="ghost"
                  size="block"
                  disabled={checking || opening}
                  onClick={() => void check()}
                >
                  重新检查
                </Button>
              )}
            </div>
          )}
          {canWithdraw && (
            <div className="signin-notices signin-withdraw">
              <WithdrawAuthorization />
            </div>
          )}
          {info.authorize && (
            <p className="signin-foot">
              <Icon name="external" />
              将在浏览器中完成设备授权
            </p>
          )}
        </SigninPanel>
      </main>
    </div>
  )
}
function presentation(view: MembershipView): {
  title: string
  sub: string
  authorize?: boolean
  busy?: boolean
  website?: string
} {
  if (view.state === "connecting")
    return { title: "正在检查登录状态…", sub: "正在确认当前账号与设备授权", busy: true }
  if (view.state === "device_revoked")
    return { title: "设备授权已撤销", sub: "请在浏览器中重新授权这台设备。", authorize: true }
  if (view.errorCode === "ACCOUNT_BANNED")
    return { title: "账号暂不可用", sub: "当前账号受到限制，暂时无法使用。" }
  if (view.state === "error" || view.state === "configuration_error")
    return { title: "暂时无法验证", sub: "请检查网络或应用配置后重新检查。" }
  if (view.state === "expired" || view.recovery?.status === "expired")
    return {
      title: "会员已到期",
      sub: "会员到期后暂停使用，办理完成后可重新检查。",
      website: "续费会员",
    }
  if (view.recovery?.status === "none")
    return {
      title: "尚未开通会员",
      sub: "当前账号还没有可用会员，办理完成后可重新检查。",
      website: "开通会员",
    }
  if (view.recovery?.status === "revoked")
    return { title: "会员已停用", sub: "当前会员已被停用，暂时无法使用。", website: "查看会员" }
  return {
    title: "设备需要重新授权",
    sub: "当前设备的使用权限需要重新确认，请在浏览器中继续。",
    authorize: true,
  }
}
