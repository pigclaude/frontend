// 负责按可信事实解释会员、设备授权和临时故障，保持无卡片居中布局。
import { desktopText } from "../locale/text"
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
  onOpenWebsite?: (() => Promise<void>) | undefined
  canWithdraw?: boolean | undefined
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
      setError(desktopText("flows.recovery-screen.checkFailed"))
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
      setError(desktopText("flows.recovery-screen.websiteFailed"))
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
              <span className="recovery-label">{desktopText("flows.recovery-screen.account")}</span>
              {account?.nickname && <strong>{account.nickname}</strong>}
              {account?.email && <span>{account.email}</span>}
            </div>
          )}
          {account && (view.tier || date) && (
            <div className="recovery-membership">
              {view.tier && (
                <span>
                  {activeMembership
                    ? desktopText("flows.recovery-screen.currentTier")
                    : desktopText("flows.recovery-screen.previousTier")}
                  {view.tier.name}
                </span>
              )}
              {date && (
                <span>
                  {view.state === "expired"
                    ? desktopText("flows.recovery-screen.expiredAt")
                    : activeMembership
                      ? desktopText("flows.recovery-screen.validUntil")
                      : desktopText("flows.recovery-screen.previousExpiry")}
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
                  variant={info.website === "view" ? "ghost" : "primary"}
                  size="block"
                  disabled={checking || opening}
                  onClick={() => void openWebsite()}
                >
                  {opening
                    ? desktopText("flows.recovery-screen.openingWebsite")
                    : desktopText(websiteLabel[info.website])}
                </Button>
              )}
              <Button
                variant={
                  info.website && onOpenWebsite && info.website !== "view" ? "ghost" : "primary"
                }
                size="block"
                disabled={checking || opening}
                onClick={() => (info.authorize ? onAuthorize("login") : void check())}
              >
                {checking
                  ? desktopText("flows.recovery-screen.checking")
                  : info.authorize
                    ? desktopText("flows.recovery-screen.reauthorize")
                    : desktopText("flows.recovery-screen.recheck")}
              </Button>
              <Button
                variant="ghost"
                size="block"
                disabled={checking || opening}
                onClick={() => onAuthorize("switch")}
              >
                {desktopText("flows.recovery-screen.switchAccount")}
              </Button>
              {info.authorize && (
                <Button
                  variant="ghost"
                  size="block"
                  disabled={checking || opening}
                  onClick={() => void check()}
                >
                  {desktopText("flows.recovery-screen.recheckAfterAuthorize")}
                </Button>
              )}
            </div>
          )}
          {canWithdraw && (
            <div className="recovery-more">
              <WithdrawAuthorization contextId={view.actionContextId} more />
            </div>
          )}
          {info.authorize && (
            <p className="signin-foot">
              <Icon name="external" />
              {desktopText("flows.recovery-screen.authorizeInBrowser")}
            </p>
          )}
        </SigninPanel>
      </main>
    </div>
  )
}
const websiteLabel = {
  renew: "flows.recovery-screen.renewMembership",
  open: "flows.recovery-screen.openMembership",
  view: "flows.recovery-screen.membershipOverview",
} as const

function presentation(view: MembershipView): {
  title: string
  sub: string
  authorize?: boolean
  busy?: boolean
  website?: keyof typeof websiteLabel
} {
  if (view.state === "connecting")
    return {
      title: desktopText("flows.recovery-screen.checkingTitle"),
      sub: desktopText("flows.recovery-screen.checkingDescription"),
      busy: true,
    }
  if (view.state === "device_revoked")
    return {
      title: desktopText("flows.recovery-screen.revokedDeviceTitle"),
      sub: desktopText("flows.recovery-screen.revokedDeviceDescription"),
      authorize: true,
    }
  if (view.errorCode === "ACCOUNT_BANNED")
    return {
      title: desktopText("flows.recovery-screen.restrictedTitle"),
      sub: desktopText("flows.recovery-screen.restrictedDescription"),
    }
  if (view.state === "error" || view.state === "configuration_error")
    return {
      title: desktopText("flows.recovery-screen.unavailableTitle"),
      sub: desktopText("flows.recovery-screen.unavailableDescription"),
    }
  if (view.state === "expired" || view.recovery?.status === "expired")
    return {
      title: desktopText("flows.recovery-screen.expiredTitle"),
      sub: desktopText("flows.recovery-screen.expiredDescription"),
      website: "renew",
    }
  if (view.recovery?.status === "none")
    return {
      title: desktopText("flows.recovery-screen.noMembershipTitle"),
      sub: desktopText("flows.recovery-screen.noMembershipDescription"),
      website: "open",
    }
  if (view.recovery?.status === "revoked")
    return {
      title: desktopText("flows.recovery-screen.revokedMembershipTitle"),
      sub: desktopText("flows.recovery-screen.revokedMembershipDescription"),
      website: "view",
    }
  return {
    title: desktopText("flows.recovery-screen.verificationTitle"),
    sub: desktopText("flows.recovery-screen.verificationDescription"),
    authorize: true,
  }
}
