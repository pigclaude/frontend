// 负责添加或重新授权 Claude 账号，并把确认交给外部浏览器。
import { useEffect, useState, type ReactNode } from "react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Icon } from "../components/icon"
import type { AuthorizationEvent, AuthorizationState } from "../models/authorization-model"

/** Claude 授权向导 props。 */
export type AuthorizeScreenProps = {
  state: AuthorizationState
  onEvent: (event: AuthorizationEvent) => void
  onCancel: () => void
}

/** 绘制六步账号授权向导和外部浏览器等待态。 */
export function AuthorizeScreen({ state, onEvent, onCancel }: AuthorizeScreenProps) {
  const [name, setName] = useState(state.accountName || "主力 Max")
  const [fingerprint, setFingerprint] = useState(state.fingerprintSeed || "fp_4d18…73aa")
  const [copied, setCopied] = useState(false)
  const authorizationUrl =
    state.authorizationUrl ?? new URL("/authorize", window.location.origin).toString()

  useEffect(() => {
    if (state.step !== "waiting") return
    const timer = window.setInterval(() => {
      void fetch("/authorize/status")
        .then((response) => response.json() as Promise<{ approved?: boolean }>)
        .then((body) => {
          if (body.approved) onEvent({ type: "approved" })
        })
        .catch(() => undefined)
    }, 800)
    return () => window.clearInterval(timer)
  }, [onEvent, state.step])

  async function startExternalAuthorization() {
    await fetch("/authorize/reset", { method: "POST" }).catch(() => undefined)
    onEvent({ type: "start", url: authorizationUrl })
    if (window.pigclaude?.openExternal) {
      await window.pigclaude.openExternal(authorizationUrl)
    } else {
      window.open(authorizationUrl, "_blank", "noopener")
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(authorizationUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="win">
      <div className="win-top">
        <div className="traffic" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <Button className="wizard-cancel" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
      <main className="win-body">
        <div className="wiz">
          <div className="wizard-progress">
            <span>添加 Claude 账号</span>
            <span>{state.step === "completed" ? "完成" : stepLabel(state.step)}</span>
          </div>
          <div className="progress-bars" aria-hidden="true">
            {["name", "proxy", "fingerprint", "exit", "waiting", "completed"].map((step) => (
              <i
                key={step}
                className={
                  state.step === step ||
                  stepIndex(state.step) > stepIndex(step as typeof state.step)
                    ? "on"
                    : ""
                }
              />
            ))}
          </div>
          {state.step === "name" ? (
            <WizardBody
              title="给这个账号起个名字"
              description="名字只在本机显示，方便你在号池和通路条里认出它。"
            >
              <div className="field">
                <label htmlFor="authorize-name">账号名称</label>
                <Input
                  id="authorize-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="wizard-foot">
                <Button
                  variant="primary"
                  onClick={() => {
                    onEvent({ type: "set-name", accountName: name })
                    onEvent({ type: "advance" })
                  }}
                >
                  下一步
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "proxy" ? (
            <WizardBody
              title="选一个 IP 代理"
              description="这个账号的登录浏览器和以后所有对话请求，都从这一个代理出去。"
            >
              <div className="choice is-selected">
                <span className="radio-dot" />
                <div className="grow">
                  <b>LA-01</b>
                  <div className="desc">203.0.113.42 · 洛杉矶 · 住宅</div>
                </div>
                <span className="status ok">可用</span>
              </div>
              <div className="choice">
                <span className="radio-dot" />
                <div className="grow">
                  <b>SJC-02</b>
                  <div className="desc">198.51.100.17 · 圣何塞</div>
                </div>
                <span className="status ok">可用</span>
              </div>
              <div className="wizard-foot">
                <Button variant="ghost" onClick={() => onEvent({ type: "advance" })}>
                  下一步
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    onEvent({ type: "set-proxy", proxyId: "la-01" })
                    onEvent({ type: "advance" })
                  }}
                >
                  绑定 LA-01
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "fingerprint" ? (
            <WizardBody
              title="设定这个账号的指纹"
              description="指纹由你决定，保存在本机这个账号下。以后重新授权都用同一份。"
            >
              <div className="field">
                <label htmlFor="authorize-fingerprint">指纹种子</label>
                <Input
                  id="authorize-fingerprint"
                  className="mono"
                  value={fingerprint}
                  onChange={(event) => setFingerprint(event.target.value)}
                />
              </div>
              <div className="group">
                <div className="item">
                  <div className="main">
                    <div className="ttl">浏览器</div>
                    <div className="desc">Chrome 141 · macOS</div>
                  </div>
                </div>
                <div className="item">
                  <div className="main">
                    <div className="ttl">语言与时区</div>
                    <div className="desc">en-US · America/Los_Angeles</div>
                  </div>
                </div>
              </div>
              <div className="wizard-foot">
                <Button
                  variant="primary"
                  onClick={() => {
                    onEvent({ type: "set-fingerprint", fingerprintSeed: fingerprint })
                    onEvent({ type: "advance" })
                  }}
                >
                  保存并核对出口
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "exit" ? (
            <WizardBody
              title="核对出口"
              description="登录桥和中继必须经过同一个代理出口，才会进入授权。"
            >
              <div className="lanes">
                <div className="lane">
                  <b>登录桥</b>
                  <span>指纹浏览器 · 本机桥 · LA-01</span>
                  <strong>{state.bridgeExit || "待检测"}</strong>
                </div>
                <div className="lane">
                  <b>中继</b>
                  <span>本机 daemon · LA-01</span>
                  <strong>{state.daemonExit || "待检测"}</strong>
                </div>
              </div>
              {state.canLaunch ? (
                <div className="verdict good">
                  <Icon name="check" small /> 两条路出口一致，可以继续
                </div>
              ) : (
                <div className="verdict bad">
                  <Icon name="x" small /> 请勿登录：先完成出口核对
                </div>
              )}
              <div className="wizard-foot">
                <Button
                  variant="ghost"
                  onClick={() => {
                    onEvent({
                      type: "set-exits",
                      bridgeExit: "203.0.113.10",
                      daemonExit: "198.51.100.20",
                    })
                    onEvent({ type: "check-exit" })
                  }}
                >
                  模拟出口不一致
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    onEvent({
                      type: "set-exits",
                      bridgeExit: "203.0.113.42",
                      daemonExit: "203.0.113.42",
                    })
                    onEvent({ type: "check-exit" })
                  }}
                >
                  重新核对
                </Button>
                <Button
                  variant="primary"
                  disabled={!state.canLaunch}
                  onClick={() => void startExternalAuthorization()}
                >
                  打开浏览器授权
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "waiting" ? (
            <WizardBody
              title="在外部浏览器里完成授权"
              description="桌面端不会在软件窗口里确认授权。请在刚打开的浏览器页面中完成登录。"
            >
              <div className="browser-wait">
                <Icon name="browser" />
                <b>等待浏览器确认</b>
                <span>浏览器配置目录独立 · 出口持续核对</span>
                <span className="mono">{authorizationUrl}</span>
              </div>
              <div className="wizard-foot">
                <Button variant="secondary" onClick={() => void copyLink()}>
                  {copied ? "已复制" : "复制登录链接"}
                </Button>
                <Button variant="ghost" onClick={() => void startExternalAuthorization()}>
                  重新发起
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "completed" ? (
            <WizardBody
              title={`「${name}」已加入号池`}
              description="授权完成，指纹和代理已保存到本机。"
            >
              <div className="group">
                <div className="item">
                  <div className="main">
                    <div className="ttl">代理</div>
                    <div className="desc mono">LA-01 · 203.0.113.42</div>
                  </div>
                </div>
                <div className="item">
                  <div className="main">
                    <div className="ttl">指纹</div>
                    <div className="desc mono">{fingerprint}</div>
                  </div>
                </div>
                <div className="item">
                  <div className="main">
                    <div className="ttl">出口核对</div>
                    <div className="desc">一致 · 授权全程未改变</div>
                  </div>
                  <span className="status ok">完成</span>
                </div>
              </div>
              <div className="wizard-foot">
                <Button variant="primary" onClick={onCancel}>
                  回到账号
                </Button>
              </div>
            </WizardBody>
          ) : null}
        </div>
      </main>
    </div>
  )
}

function WizardBody({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="wizard-body">
      <div>
        <h1>{title}</h1>
        <p className="sub">{description}</p>
      </div>
      {children}
    </div>
  )
}

function stepIndex(step: AuthorizationState["step"]) {
  return ["name", "proxy", "fingerprint", "exit", "waiting", "completed"].indexOf(step)
}

function stepLabel(step: AuthorizationState["step"]) {
  return {
    name: "账号名称",
    proxy: "绑定代理",
    fingerprint: "设定指纹",
    exit: "出口核对",
    waiting: "浏览器授权",
    completed: "完成",
  }[step]
}
