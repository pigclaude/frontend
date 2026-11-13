// 负责展示 PigClaude 登录/注册入口、等待浏览器授权、确认会员和授权失败四种状态。
import { desktopText } from "../locale/text"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { WithdrawAuthorization } from "../components/withdraw-authorization"
import { Icon } from "../components/icon"
import { TrafficLights } from "../components/traffic-lights"
import { Button } from "../components/ui/button"
import { SigninPanel } from "../components/signin-panel"
import type { LoginIntent, LoginState } from "../models/login-model"

/** 浏览器授权登录页面 props。授权完成后由会员状态决定去向，页面不再提供成功页。 */
export type LoginScreenProps = {
  state: LoginState
  gateMessage?: string | undefined
  signingOut?: boolean
  withdrawContextId?: string | undefined
  canWithdraw?: boolean | undefined
  onRetrySignOut?: (() => void) | undefined
  onAuthorize: (intent: LoginIntent) => void
  onCancel: () => void
  onReset: () => void
}

/** 按授权状态画出登录页、等待浏览器页、确认会员页或失败页。完整授权链接只用于复制，不显示在页面上。 */
export function LoginScreen(props: LoginScreenProps) {
  const { state } = props
  const intent = state.intent ?? "login"
  return (
    <div className="win">
      <div className="win-top">
        <TrafficLights />
      </div>
      <main className="win-body signin-body">
        {state.view === "committing" ? (
          <SigninPanel
            icon="spinner"
            busy
            title={desktopText("flows.login-screen.savingTitle")}
            sub={desktopText("flows.login-screen.savingDescription")}
          />
        ) : state.view === "confirming" ? (
          <ConfirmingPanel displayName={state.displayName} />
        ) : state.view === "error" ? (
          <ErrorPanel
            error={state.error}
            onRetry={() => props.onAuthorize(intent)}
            onBack={props.onReset}
          />
        ) : state.view === "starting" || state.view === "waiting" ? (
          <WaitingPanel
            intent={intent}
            starting={state.view === "starting"}
            authorizationUrl={state.authorizationUrl}
            onReopen={() => props.onAuthorize(intent)}
            onCancel={props.onCancel}
          />
        ) : (
          <IdlePanel {...props} />
        )}
      </main>
    </div>
  )
}

function IdlePanel({
  gateMessage,
  signingOut,
  canWithdraw,
  withdrawContextId,
  onRetrySignOut,
  onAuthorize,
}: LoginScreenProps) {
  const locked = Boolean(signingOut || onRetrySignOut)
  const hasNotices = Boolean(gateMessage || canWithdraw)
  return (
    <SigninPanel
      icon="snout"
      title={desktopText("flows.login-screen.signOutRetry")}
      sub={desktopText("flows.login-screen.welcomeTitle")}
    >
      {hasNotices ? (
        <div className="signin-notices">
          {gateMessage ? (
            <Notice
              tone={onRetrySignOut ? "bad" : signingOut ? "busy" : "info"}
              action={
                onRetrySignOut ? (
                  <Button size="sm" onClick={onRetrySignOut}>
                    {desktopText("flows.login-screen.welcomeDescription")}
                  </Button>
                ) : null
              }
            >
              {gateMessage}
            </Notice>
          ) : null}
          {canWithdraw ? (
            <div className="signin-withdraw">
              <WithdrawAuthorization contextId={withdrawContextId} />
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="signin-actions">
        <Button
          variant="primary"
          size="block"
          disabled={locked}
          onClick={() => onAuthorize("login")}
        >
          {desktopText("flows.login-screen.login")}
        </Button>
        <Button
          variant="ghost"
          size="block"
          disabled={locked}
          onClick={() => onAuthorize("register")}
        >
          {desktopText("flows.login-screen.register")}
        </Button>
      </div>
      <p className="signin-foot">
        <Icon name="external" />
        {desktopText("flows.login-screen.opensWebsite")}
      </p>
    </SigninPanel>
  )
}

function WaitingPanel({
  intent,
  starting,
  authorizationUrl,
  onReopen,
  onCancel,
}: {
  intent: LoginIntent
  starting: boolean
  authorizationUrl: string | null
  onReopen: () => void
  onCancel: () => void
}) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    [],
  )

  async function copyLink(): Promise<void> {
    if (!authorizationUrl) return
    try {
      await navigator.clipboard.writeText(authorizationUrl)
      setCopied(true)
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  const verb =
    intent === "register"
      ? desktopText("flows.login-screen.registrationIntent")
      : desktopText("flows.login-screen.loginIntent")
  return (
    <SigninPanel
      icon="browser"
      title={desktopText("flows.login-screen.browserTitle")}
      sub={
        intent === "switch"
          ? desktopText("flows.login-screen.switchDescription")
          : desktopText("flows.login-screen.browserDescription", { value1: String(verb) })
      }
    >
      <p className="signin-progress" role="status">
        <span className="signin-pulse" aria-hidden="true" />
        {starting
          ? desktopText("flows.login-screen.openingBrowser")
          : desktopText("flows.login-screen.waitingApproval")}
      </p>
      <div className="signin-actions">
        <Button variant="primary" size="block" disabled={starting} onClick={onReopen}>
          {desktopText("flows.login-screen.reopenBrowser")}
        </Button>
        <div className="signin-row">
          <Button
            variant="ghost"
            size="lg"
            className={copied ? "is-copied" : undefined}
            disabled={!authorizationUrl}
            onClick={() => void copyLink()}
          >
            <Icon name={copied ? "check" : "copy"} />
            {copied
              ? desktopText("flows.login-screen.copiedLink")
              : desktopText("flows.login-screen.copyLink")}
          </Button>
          <Button variant="ghost" size="lg" onClick={onCancel}>
            {desktopText("flows.login-screen.cancel")}
          </Button>
        </div>
      </div>
    </SigninPanel>
  )
}

function ConfirmingPanel({ displayName }: { displayName: string | null }) {
  return (
    <SigninPanel
      icon="spinner"
      busy
      title={desktopText("flows.login-screen.confirmingTitle")}
      sub={
        displayName
          ? desktopText("flows.login-screen.confirmedName", { value1: String(displayName) })
          : desktopText("flows.login-screen.browserCompleted")
      }
    />
  )
}

function ErrorPanel({
  error,
  onRetry,
  onBack,
}: {
  error: string | null
  onRetry: () => void
  onBack: () => void
}) {
  return (
    <SigninPanel
      icon="alert"
      tone="bad"
      title={desktopText("flows.login-screen.failedTitle")}
      sub={
        error?.startsWith("SAFE_STORAGE_UNAVAILABLE")
          ? desktopText("flows.login-screen.failedDescription")
          : (error ?? desktopText("flows.login-screen.reauthorize"))
      }
    >
      <div className="signin-actions">
        <Button variant="primary" size="block" onClick={onRetry}>
          {desktopText("flows.login-screen.back")}
        </Button>
        <Button variant="ghost" size="block" onClick={onBack}>
          {desktopText("flows.login-screen.return")}
        </Button>
      </div>
    </SigninPanel>
  )
}

function Notice({
  tone,
  action,
  children,
}: {
  tone: "info" | "busy" | "bad"
  action: ReactNode
  children: ReactNode
}) {
  return (
    <div className="signin-notice" data-tone={tone} role={tone === "bad" ? "alert" : "status"}>
      <Icon
        name={tone === "bad" ? "alert" : tone === "busy" ? "spinner" : "info"}
        className={tone === "busy" ? "signin-spinner" : undefined}
      />
      <span>{children}</span>
      {action}
    </div>
  )
}
