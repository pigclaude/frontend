// 负责展示 PigClaude 登录/注册入口、等待浏览器授权、确认会员和授权失败四种状态。
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
            title="正在保存授权…"
            sub="保存完成后将确认会员状态，请稍候。"
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
    <SigninPanel icon="snout" title="欢迎使用 PigClaude" sub="登录后即可使用你的会员">
      {hasNotices ? (
        <div className="signin-notices">
          {gateMessage ? (
            <Notice
              tone={onRetrySignOut ? "bad" : signingOut ? "busy" : "info"}
              action={
                onRetrySignOut ? (
                  <Button size="sm" onClick={onRetrySignOut}>
                    重试退出
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
          登录
        </Button>
        <Button
          variant="ghost"
          size="block"
          disabled={locked}
          onClick={() => onAuthorize("register")}
        >
          注册
        </Button>
      </div>
      <p className="signin-foot">
        <Icon name="external" />
        将在浏览器中打开 PigClaude 网站完成
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

  const verb = intent === "register" ? "注册" : "登录"
  return (
    <SigninPanel
      icon="browser"
      title="请在浏览器中继续"
      sub={
        intent === "switch"
          ? "请选择要用于桌面的账号并确认设备授权，完成后会自动回到这里。"
          : `已为你打开 PigClaude 网站，${verb}并授权这台设备后会自动回到这里。`
      }
    >
      <p className="signin-progress" role="status">
        <span className="signin-pulse" aria-hidden="true" />
        {starting ? "正在打开浏览器…" : "等待浏览器授权"}
      </p>
      <div className="signin-actions">
        <Button variant="primary" size="block" disabled={starting} onClick={onReopen}>
          重新打开浏览器
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
            {copied ? "已复制" : "复制链接"}
          </Button>
          <Button variant="ghost" size="lg" onClick={onCancel}>
            取消
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
      title="正在确认会员…"
      sub={displayName ? `${displayName} 已授权这台设备` : "浏览器授权已完成"}
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
      title="浏览器授权未完成"
      sub={
        error?.startsWith("SAFE_STORAGE_UNAVAILABLE")
          ? "系统安全存储不可用，授权未保存。请重试或返回原账号。"
          : (error ?? "请重新打开浏览器授权页面。")
      }
    >
      <div className="signin-actions">
        <Button variant="primary" size="block" onClick={onRetry}>
          重新授权
        </Button>
        <Button variant="ghost" size="block" onClick={onBack}>
          返回
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
