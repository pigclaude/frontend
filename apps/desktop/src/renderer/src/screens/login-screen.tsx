// 负责 pigclaude 软件使用权限登录，不启动 Claude 账号授权。
import { useState, type ReactNode } from "react"
import { Icon } from "../components/icon"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import type { LoginEvent, LoginMode, LoginState } from "../models/login-model"

/** 权限登录页面 props。 */
export type LoginScreenProps = {
  state: LoginState
  onEvent: (event: LoginEvent) => void
  onSuccess: () => void
}

/** 绘制原型里的邮箱密码/验证码登录和离线结果状态。 */
export function LoginScreen({ state, onEvent, onSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState(state.email)
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [countdown, setCountdown] = useState(0)

  function chooseMode(mode: LoginMode) {
    onEvent({ type: "set-mode", mode })
  }

  function submit() {
    onEvent({ type: "submit", email, password, code })
  }

  function sendCode() {
    if (!email.trim() || countdown > 0) return
    setCountdown(60)
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer)
          return 0
        }
        return value - 1
      })
    }, 1000)
  }

  if (state.view === "denied") {
    return (
      <AuthWindow>
        <ResultState
          icon="lock"
          title="暂未开通"
          description="这个账户还没有 pigclaude 使用权限，请联系提供方开通后再试。"
          action={<Button onClick={submit}>重新检查</Button>}
          secondary={
            <Button variant="ghost" onClick={() => onEvent({ type: "reset" })}>
              切换账户
            </Button>
          }
        />
      </AuthWindow>
    )
  }

  if (state.view === "offline-allow") {
    return (
      <AuthWindow>
        <ResultState
          icon="wifi"
          title="暂时连不上服务"
          description={`沿用上次已开通的结果：${state.checkedAt ?? "最近一次"}。联网后会自动重新校验。`}
          action={
            <Button variant="primary" onClick={onSuccess}>
              继续使用
            </Button>
          }
          secondary={
            <Button variant="ghost" onClick={submit}>
              重试
            </Button>
          }
        />
      </AuthWindow>
    )
  }

  if (state.view === "offline-none") {
    return (
      <AuthWindow>
        <ResultState
          icon="wifi"
          title="需要联网登录"
          description="这台电脑还没有可沿用的权限记录，联网完成一次校验后才能使用。"
          action={
            <Button variant="primary" onClick={submit}>
              重试
            </Button>
          }
        />
      </AuthWindow>
    )
  }

  if (state.view === "success") {
    return (
      <AuthWindow>
        <ResultState
          icon="check"
          title="已确认使用权限"
          description="接下来配置本机代理和 Claude 账号。"
          action={
            <Button variant="primary" onClick={onSuccess}>
              开始使用
            </Button>
          }
        />
      </AuthWindow>
    )
  }

  const checking = state.view === "checking"
  return (
    <AuthWindow>
      <div className="login">
        <div className="mark" aria-hidden="true">
          <Icon name="snout" />
        </div>
        <h1>登录 pigclaude</h1>
        <p className="sub">登录后会确认你的账户是否已开通。</p>
        <form
          className="col login-form"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="seg" role="group" aria-label="登录方式">
            <button
              className={state.mode === "password" ? "is-active" : ""}
              type="button"
              onClick={() => chooseMode("password")}
            >
              邮箱与密码
            </button>
            <button
              className={state.mode === "code" ? "is-active" : ""}
              type="button"
              onClick={() => chooseMode("code")}
            >
              邮箱验证码
            </button>
          </div>
          <div className="field">
            <label htmlFor="login-email">邮箱</label>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </div>
          {state.mode === "password" ? (
            <div className="field">
              <label htmlFor="login-password">密码</label>
              <div className="pw">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  <Icon name={showPassword ? "x" : "eye"} small />
                </button>
              </div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="login-code">验证码</label>
              <div className="code-row">
                <Input
                  id="login-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={sendCode}
                  disabled={countdown > 0}
                >
                  {countdown > 0 ? `${countdown}s` : "发送验证码"}
                </Button>
              </div>
            </div>
          )}
          {state.error ? (
            <p className="error-text">
              <Icon name="alert" small />
              {state.error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" size="block" disabled={checking}>
            {checking ? "检查中…" : "登录"}
          </Button>
          <div className="alt">
            <button className="link" type="button">
              忘记密码
            </button>
            <span className="muted">没有账户？向提供方申请开通</span>
          </div>
        </form>
      </div>
    </AuthWindow>
  )
}

function AuthWindow({ children }: { children: ReactNode }) {
  return (
    <div className="win">
      <div className="win-top">
        <div className="traffic" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
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
