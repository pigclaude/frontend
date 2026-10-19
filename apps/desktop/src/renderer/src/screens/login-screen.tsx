// 负责展示 pigclaude 登录/注册浏览器授权入口和等待状态。
import { WithdrawAuthorization } from "../components/withdraw-authorization"
import { useState, type ReactNode } from "react"
import { Icon } from "../components/icon"
import { TrafficLights } from "../components/traffic-lights"
import { Button } from "../components/ui/button"
import type { LoginIntent, LoginState } from "../models/login-model"

/** 浏览器授权登录页面 props。 */
export type LoginScreenProps = {
  state: LoginState
  gateMessage?: string
  signingOut?: boolean
  canWithdraw?: boolean
  onRetrySignOut?: () => void
  onAuthorize: (intent: LoginIntent) => void
  onCancel: () => void
  onReset: () => void
  onSuccess: () => void
}

/** 绘制登录/注册两个浏览器授权入口和回调等待态。 */
export function LoginScreen({
  state,
  gateMessage,
  signingOut,
  canWithdraw,
  onRetrySignOut,
  onAuthorize,
  onCancel,
  onReset,
  onSuccess,
}: LoginScreenProps) {
  const [copied, setCopied] = useState(false)
  const intent = state.intent ?? "login"
  const title = intent === "register" ? "注册 pigclaude" : "登录 pigclaude"

  if (state.view === "success") {
    return (
      <AuthWindow>
        <ResultState
          icon="check"
          title={intent === "register" ? "注册并授权完成" : "已确认使用权限"}
          description={`${state.displayName ?? "当前账户"} 已连接这台设备，接下来配置本机代理和 Claude 账号。`}
          action={
            <Button variant="primary" onClick={onSuccess}>
              开始使用
            </Button>
          }
        />
      </AuthWindow>
    )
  }

  if (state.view === "error") {
    return (
      <AuthWindow>
        <ResultState
          icon="alert"
          title="浏览器授权未完成"
          description={state.error ?? "请重新打开浏览器授权页面。"}
          action={<Button onClick={() => onAuthorize(intent)}>重新授权</Button>}
          secondary={
            <Button variant="ghost" onClick={onReset}>
              返回
            </Button>
          }
        />
      </AuthWindow>
    )
  }

  if (state.view === "starting" || state.view === "waiting") {
    async function copyLink() {
      if (!state.authorizationUrl) return
      try {
        await navigator.clipboard.writeText(state.authorizationUrl)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      } catch {
        setCopied(false)
      }
    }

    return (
      <AuthWindow>
        <div className="result auth-result">
          <div className="r-title">
            <Icon name="browser" small />
            等待浏览器确认
          </div>
          <p>
            {intent === "register"
              ? "请在刚打开的浏览器中完成注册并确认授权。"
              : "请在刚打开的浏览器中登录并确认这台设备。"}
          </p>
          <div className="browser-wait">
            <Icon name="browser" />
            <b>{state.view === "starting" ? "正在打开系统浏览器…" : "浏览器配置目录独立"}</b>
            <span>桌面端不会接收你的密码或验证码</span>
            {state.authorizationUrl ? <span className="mono">{state.authorizationUrl}</span> : null}
          </div>
          <div className="row">
            {state.authorizationUrl ? (
              <Button variant="secondary" onClick={() => void copyLink()}>
                {copied ? "已复制" : "复制授权链接"}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onAuthorize(intent)}>
              重新打开
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              取消
            </Button>
          </div>
        </div>
      </AuthWindow>
    )
  }

  return (
    <AuthWindow>
      <div className="login">
        <div className="mark" aria-hidden="true">
          <Icon name="snout" />
        </div>
        <h1>{title}</h1>
        <p className="sub">使用系统浏览器授权，桌面端不会保存你的密码。</p>
        {canWithdraw && <WithdrawAuthorization />}
        {gateMessage ? <p className="muted login-note">{gateMessage}</p> : null}
        <div className="col login-form">
          {onRetrySignOut ? <Button onClick={onRetrySignOut}>重试退出</Button> : null}
          <Button
            variant="primary"
            size="block"
            disabled={signingOut || Boolean(onRetrySignOut)}
            onClick={() => onAuthorize("login")}
          >
            登录
          </Button>
          <Button
            variant="secondary"
            size="block"
            disabled={signingOut || Boolean(onRetrySignOut)}
            onClick={() => onAuthorize("register")}
          >
            注册
          </Button>
          <p className="muted login-note">登录和注册都会在浏览器中完成，不会在这里输入凭据。</p>
        </div>
      </div>
    </AuthWindow>
  )
}

function AuthWindow({ children }: { children: ReactNode }) {
  return (
    <div className="win">
      <div className="win-top">
        <TrafficLights />
      </div>
      <main className="win-body">{children}</main>
    </div>
  )
}

function ResultState({
  icon,
  title,
  description,
  action,
  secondary,
}: {
  icon: string
  title: string
  description: string
  action: ReactNode
  secondary?: ReactNode
}) {
  return (
    <div className="result auth-result">
      <div className="r-title">
        <Icon name={icon} small />
        {title}
      </div>
      <p>{description}</p>
      <div className="row">
        {action}
        {secondary}
      </div>
    </div>
  )
}
