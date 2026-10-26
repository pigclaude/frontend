// 负责添加或重新授权 Claude 账号；指纹步骤拆到 fingerprint-step，出口核对交给主进程。
import { useState, type ReactNode } from "react"
import type { ClaudeAccountView, ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Icon } from "../components/icon"
import { TrafficLights } from "../components/traffic-lights"
import type { PoolProxy } from "../fixtures/pool-fixtures"
import {
  fingerprintHeadline,
  fingerprintLocaleLine,
  normalizeFingerprintForm,
} from "../models/fingerprint-form"
import type { AuthorizationEvent, AuthorizationState } from "../models/authorization-model"
import { FingerprintStep } from "./authorize/fingerprint-step"

/** Claude 授权向导 props。 */
export type AuthorizeScreenProps = {
  state: AuthorizationState
  proxies: PoolProxy[]
  account?: ClaudeAccountView | null
  onEvent: (event: AuthorizationEvent) => void
  onStartBrowserAuthorization: (input: {
    accountId?: string
    displayName: string
    proxyId: string | null
    fingerprint: ClaudeFingerprintView
  }) => void
  onCancel: () => void
}

/** 绘制六步账号授权向导和外部浏览器等待态。 */
export function AuthorizeScreen({
  state,
  proxies,
  account,
  onEvent,
  onStartBrowserAuthorization,
  onCancel,
}: AuthorizeScreenProps) {
  const [name, setName] = useState(state.accountName || account?.displayName || "主力 Max")
  // 空字符串表示显式选择「不使用代理」；null 表示原代理已不存在、用户尚未重新选择。
  const [proxyId, setProxyId] = useState<string | null>(() =>
    initialProxyChoice(state, account, proxies),
  )
  // 草稿放在授权页而不是指纹步骤里；fingerprint → proxy → fingerprint 切换时不丢修改。
  const [fingerprint, setFingerprint] = useState<ClaudeFingerprintView>(
    () => state.fingerprint ?? initialFingerprint(account),
  )
  const selectedProxy = proxies.find((proxy) => proxy.id === proxyId) ?? null

  function startBrowserAuthorization() {
    if (name.trim() === "" || proxyId === null) return
    onStartBrowserAuthorization({
      accountId: account?.id,
      displayName: name.trim(),
      proxyId: proxyId === "" ? null : proxyId,
      fingerprint,
    })
  }

  return (
    <div className="win">
      <div className="win-top">
        <TrafficLights />
        <Button className="wizard-cancel" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
      <main className="win-body">
        <div className="wiz">
          <div className="wizard-progress">
            <span>{account ? "重新授权 Claude 账号" : "添加 Claude 账号"}</span>
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
                  disabled={name.trim() === ""}
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
              title="选择网络出口"
              description="绑定代理后，这个账号的登录浏览器和以后所有对话请求都从代理出去；不绑定则使用系统网络。"
            >
              <Button
                variant="plain"
                className={proxyId === "" ? "choice is-selected" : "choice"}
                type="button"
                onClick={() => setProxyId("")}
              >
                <span className="radio-dot" />
                <div className="grow">
                  <b>不使用代理（系统网络）</b>
                  <div className="desc">登录和对话都从本机网络发出</div>
                </div>
              </Button>
              {proxyId === null ? (
                <p className="error-text" role="alert">
                  原代理已不存在，请重新选择网络出口
                </p>
              ) : null}
              {proxies.length === 0 ? (
                <p className="note">还没有代理。也可以继续使用系统网络。</p>
              ) : null}
              {proxies.map((proxy) => (
                <Button
                  variant="plain"
                  key={proxy.id}
                  className={proxyId === proxy.id ? "choice is-selected" : "choice"}
                  type="button"
                  onClick={() => setProxyId(proxy.id)}
                >
                  <span className="radio-dot" />
                  <div className="grow">
                    <b>{proxy.name}</b>
                    <div className="desc">
                      {proxy.exit} · {proxy.region}
                    </div>
                  </div>
                  <span className={proxy.available ? "status ok" : "status bad"}>
                    {proxy.available ? `${proxy.latency} ms` : "待测试"}
                  </span>
                </Button>
              ))}
              <div className="wizard-foot">
                <Button
                  variant="primary"
                  disabled={proxyId === null}
                  onClick={() => {
                    if (proxyId === null) return
                    onEvent({ type: "set-proxy", proxyId: proxyId === "" ? null : proxyId })
                    onEvent({ type: "advance" })
                  }}
                >
                  {proxyId === null
                    ? "请选择网络出口"
                    : proxyId === ""
                      ? "使用系统网络"
                      : "绑定代理"}
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "fingerprint" ? (
            <FingerprintStep
              value={fingerprint}
              submitLabel={proxyId === "" ? "保存并继续" : "保存并核对出口"}
              error={state.error}
              onChange={setFingerprint}
              onSubmit={(next) => {
                setFingerprint(next)
                onEvent({ type: "set-fingerprint", fingerprint: next })
                onEvent({ type: "advance" })
              }}
              onBack={() => onEvent({ type: "back" })}
            />
          ) : null}
          {state.step === "exit" ? (
            <WizardBody
              title={proxyId === "" ? "使用系统网络并打开授权页" : "核对出口并打开授权页"}
              description={
                proxyId === ""
                  ? "这个账号没有绑定代理，登录和对话请求都会从本机网络直接发出。"
                  : proxyId === null
                    ? "原代理已不存在，请返回上一步重新选择网络出口。"
                    : "主进程会先核对代理桥和 daemon 出口，一致后才会启动指纹浏览器内核。"
              }
            >
              <div className="group">
                <div className="item">
                  <div className="main">
                    <div className="ttl">网络出口</div>
                    <div className="desc mono">
                      {selectedProxy
                        ? `${selectedProxy.name} · ${selectedProxy.exit}`
                        : proxyId === ""
                          ? "系统网络（直连）"
                          : "原代理已不存在"}
                    </div>
                  </div>
                </div>
                {proxyId === "" ? (
                  <div className="item">
                    <div className="main">
                      <div className="ttl">出口核对</div>
                      <div className="desc">系统网络，无需出口核对</div>
                    </div>
                  </div>
                ) : null}
                <div className="item">
                  <div className="main">
                    <div className="ttl">指纹种子</div>
                    <div className="desc mono">{fingerprint.seed || "按账号 ID 生成"}</div>
                  </div>
                </div>
                <div className="item">
                  <div className="main">
                    <div className="ttl">画像</div>
                    <div className="desc">{fingerprintHeadline(fingerprint)}</div>
                    <div className="desc">{fingerprintLocaleLine(fingerprint)}</div>
                  </div>
                </div>
              </div>
              {proxyId === null ? (
                <p className="error-text" role="alert">
                  原代理已不存在，请重新选择网络出口
                </p>
              ) : null}
              {state.error ? <p className="error-text">{state.error}</p> : null}
              <div className="wizard-foot">
                <Button variant="ghost" onClick={() => onEvent({ type: "back" })}>
                  返回修改指纹
                </Button>
                <Button
                  variant="primary"
                  disabled={name.trim() === "" || proxyId === null}
                  onClick={startBrowserAuthorization}
                >
                  {proxyId === "" ? "开始授权" : state.error ? "重新核对" : "开始核对并授权"}
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "waiting" ? (
            <WizardBody
              title="在外部浏览器里完成授权"
              description="桌面端不会在软件窗口里确认授权。请在刚打开的指纹浏览器里完成登录。"
            >
              <div className="browser-wait">
                <Icon name="browser" />
                <b>等待浏览器确认</b>
                <span>
                  {proxyId === ""
                    ? "授权过程中出站流量使用系统网络"
                    : "授权过程中出站流量持续绑定在该账号的代理上"}
                </span>
                {state.error ? <span className="error-text">{state.error}</span> : null}
              </div>
              <div className="wizard-foot">
                <Button variant="secondary" onClick={startBrowserAuthorization}>
                  重新发起
                </Button>
                <Button variant="ghost" onClick={onCancel}>
                  取消
                </Button>
              </div>
            </WizardBody>
          ) : null}
          {state.step === "completed" ? (
            <WizardBody
              title={`「${name}」已加入号池`}
              description="授权完成，凭据、指纹和网络设置已保存到本机。"
            >
              <div className="group">
                <div className="item">
                  <div className="main">
                    <div className="ttl">网络出口</div>
                    <div className="desc mono">
                      {selectedProxy
                        ? `${selectedProxy.name} · ${selectedProxy.exit}`
                        : proxyId === ""
                          ? "系统网络（直连）"
                          : "原代理已不存在"}
                    </div>
                  </div>
                </div>
                <div className="item">
                  <div className="main">
                    <div className="ttl">指纹种子</div>
                    <div className="desc mono">{fingerprint.seed || "按账号 ID 生成"}</div>
                  </div>
                </div>
                <div className="item">
                  <div className="main">
                    <div className="ttl">画像</div>
                    <div className="desc">{fingerprintHeadline(fingerprint)}</div>
                    <div className="desc">{fingerprintLocaleLine(fingerprint)}</div>
                  </div>
                </div>
                <div className="item">
                  <div className="main">
                    <div className="ttl">出口核对</div>
                    <div className="desc">
                      {proxyId === ""
                        ? "系统网络，无需出口核对"
                        : selectedProxy === null
                          ? "未完成出口核对"
                          : "一致 · 授权全程未改变"}
                    </div>
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
    proxy: "网络出口",
    fingerprint: "设定指纹",
    exit: "出口核对",
    waiting: "浏览器授权",
    completed: "完成",
  }[step]
}

/**
 * 选择代理步骤的初始值：空字符串表示显式使用系统网络，null 表示原代理已不存在、尚未重新选择。
 * 保证 direct 账号默认选中系统网络，悬空绑定不会被静默改成直连。
 */
function initialProxyChoice(
  state: AuthorizationState,
  account: ClaudeAccountView | null | undefined,
  proxies: PoolProxy[],
): string | null {
  if (state.proxyId !== null) {
    return proxies.some((proxy) => proxy.id === state.proxyId) ? state.proxyId : null
  }
  if (account === null || account === undefined) return proxies[0]?.id ?? ""
  if (account.proxyId === null) return ""
  return proxies.some((proxy) => proxy.id === account.proxyId) ? account.proxyId : null
}

/** 指纹步骤的初始值：已保存的指纹优先，否则用 AntBrowser 默认值补全。 */
function initialFingerprint(account: ClaudeAccountView | null | undefined): ClaudeFingerprintView {
  return normalizeFingerprintForm(account?.fingerprint)
}
