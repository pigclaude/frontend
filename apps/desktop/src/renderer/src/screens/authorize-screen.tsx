// 添加账号只选择共享浏览器配置，语言、时区和网络不在向导内另存副本。

import { useEffect, useRef, useState } from "react"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { BrowserProfileView } from "@pigclaude/contracts/browser-profile"
import type { AuthorizeClaudeAccountInput } from "../../../main/claude/account-service-inputs"
import type { PoolProxy } from "../fixtures/pool-fixtures"
import type { AuthorizationEvent, AuthorizationState } from "../models/authorization-model"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { TrafficLights } from "../components/traffic-lights"

/** 账号向导使用主进程配置列表，重新授权始终引用账号已绑定的配置。 */
export type AuthorizeScreenProps = {
  state: AuthorizationState
  profiles?: BrowserProfileView[]
  profilesLoading?: boolean
  profilesError?: string | null
  proxies: PoolProxy[]
  account?: ClaudeAccountView | null
  onEvent: (event: AuthorizationEvent) => void
  onStartBrowserAuthorization: (input: AuthorizeClaudeAccountInput) => void
  onCancel: () => void
  onOpenProfiles?: () => void
}

/** 绘制名称、配置选择、自检与用户授权步骤，禁止提交自报指纹代替配置引用。 */
export function AuthorizeScreen({
  state,
  profiles = [],
  profilesLoading,
  profilesError,
  proxies,
  account,
  onEvent,
  onStartBrowserAuthorization,
  onCancel,
  onOpenProfiles,
}: AuthorizeScreenProps) {
  const [name, setName] = useState(state.accountName || account?.displayName || "主力 Max")
  const [profileId, setProfileId] = useState(
    state.browserProfileId ?? account?.browserProfileId ?? "",
  )
  const launching = useRef(false)
  useEffect(() => {
    if (state.step === "waiting" || state.step === "completed" || state.error)
      launching.current = false
  }, [state.step, state.error])
  const selected = profiles.find((profile) => profile.id === profileId)
  const proxy = proxies.find((item) => item.id === selected?.proxyId)
  const selecting = state.step === "proxy" || state.step === "fingerprint"
  const steps = ["name", "proxy", "exit", "waiting", "completed"]
  const current = steps.indexOf(selecting ? "proxy" : state.step)
  const title =
    state.step === "name"
      ? "给这个账号起个名字"
      : selecting
        ? "选择浏览器配置"
        : state.step === "exit"
          ? "检测本次授权环境"
          : state.step === "waiting"
            ? "查看本机自检报告并继续授权"
            : "已加入号池"
  function start(): void {
    if (launching.current || !selected || !name.trim()) return
    launching.current = true
    onStartBrowserAuthorization({
      accountId: account?.id,
      displayName: name.trim(),
      browserProfileId: selected.id,
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
            <span>
              {selecting
                ? "浏览器配置"
                : state.step === "name"
                  ? "账号名称"
                  : state.step === "exit"
                    ? "环境自检"
                    : state.step === "waiting"
                      ? "浏览器授权"
                      : "完成"}
            </span>
          </div>
          <div className="progress-bars" aria-hidden="true">
            {steps.map((step, index) => (
              <i key={step} className={index <= current ? "on" : ""} />
            ))}
          </div>
          <h1>{title}</h1>
          {state.step === "name" ? (
            <>
              <p className="wiz-desc">
                名字只在本机显示。账号将使用所选浏览器配置，登录数据独立保存。
              </p>
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
                  disabled={!name.trim()}
                  onClick={() => {
                    onEvent({ type: "set-name", accountName: name })
                    onEvent({ type: "advance" })
                  }}
                >
                  下一步
                </Button>
              </div>
            </>
          ) : null}
          {selecting ? (
            <>
              <p className="wiz-desc">
                选择已配置的指纹、代理、语言和时区；浏览器与 CLI 共用配置，每个账号的
                Cookie、缓存和登录数据独立。
              </p>
              {profilesLoading ? <p className="note">正在读取浏览器配置…</p> : null}
              {!profilesLoading && !profiles.length ? (
                <p className="note">还没有浏览器配置，请先在号池中创建。</p>
              ) : null}
              {profilesError ? (
                <p className="error-text" role="alert">
                  {profilesError}
                </p>
              ) : null}
              {profiles
                .filter((profile) => !account || profile.id === account.browserProfileId)
                .map((profile) => (
                  <Button
                    key={profile.id}
                    variant="plain"
                    className={profileId === profile.id ? "choice is-selected" : "choice"}

                    onClick={() => setProfileId(profile.id)}
                  >
                    <span className="radio-dot" />
                    <span className="grow">
                      <b>{profile.name}</b>
                      <span className="desc">
                        {profile.fingerprint.lang} · {profile.fingerprint.timezone}
                      </span>
                      <span className="desc">
                        {profile.proxyId
                          ? (proxies.find((item) => item.id === profile.proxyId)?.name ??
                            "原代理不存在")
                          : "系统网络"}{" "}
                        · {profile.boundAccounts.length} 个账号复用配置
                      </span>
                    </span>
                  </Button>
                ))}
              {account && !profilesLoading && !selected ? (
                <p className="error-text" role="alert">
                  账号关联的浏览器配置不存在，请先恢复或更换配置。
                </p>
              ) : null}
              <div className="wizard-foot">
                <Button variant="ghost" onClick={onOpenProfiles}>
                  管理浏览器指纹
                </Button>
                <Button
                  variant="primary"
                  disabled={!selected || profilesLoading}
                  onClick={() => {
                    if (selected)
                      onEvent({ type: "select-browser-profile", browserProfileId: selected.id })
                  }}
                >
                  使用此配置
                </Button>
              </div>
            </>
          ) : null}
          {state.step === "exit" ? (
            <>
              <p className="wiz-desc">
                由本次 PigBrowser 与原生 CLI 检测所选配置和实际网络；必需项通过后才提供授权入口。
              </p>
              <div className="group">
                <div className="item">
                  <span className="main">浏览器配置</span>
                  <span>{selected?.name ?? "配置不可用"}</span>
                </div>
                <div className="item">
                  <span className="main">网络出口</span>
                  <span>{selected?.proxyId ? (proxy?.name ?? "代理不可用") : "系统网络"}</span>
                </div>
                <div className="item">
                  <span className="main">浏览器与 CLI</span>
                  <span>
                    {selected?.fingerprint.lang} · {selected?.fingerprint.timezone}
                  </span>
                </div>
              </div>
              <div className="wizard-foot">
                <Button variant="ghost" onClick={() => onEvent({ type: "back" })}>
                  返回选择配置
                </Button>
                <Button variant="primary" disabled={!selected} onClick={start}>
                  检测环境并准备授权
                </Button>
              </div>
            </>
          ) : null}
          {state.step === "waiting" ? (
            <>
              <p className="wiz-desc">
                查看刚打开的 PigBrowser 报告。必需项全部通过后，由你继续完成 Claude 登录和授权。
              </p>
              <p className="note">等待浏览器确认；本次浏览器与 CLI 使用同一配置。</p>
              <div className="wizard-foot">
                <Button variant="secondary" onClick={start}>
                  重新自检
                </Button>
                <Button variant="ghost" onClick={onCancel}>
                  取消
                </Button>
              </div>
            </>
          ) : null}
          {state.step === "completed" ? (
            <>
              <p className="wiz-desc">账号已绑定所选浏览器配置，凭据只保存在本机。</p>
              <div className="wizard-foot">
                <Button variant="primary" onClick={onCancel}>
                  回到账号
                </Button>
              </div>
            </>
          ) : null}
          {state.error ? (
            <p className="error-text" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  )
}
