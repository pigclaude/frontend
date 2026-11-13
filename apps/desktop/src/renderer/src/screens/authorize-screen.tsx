// 添加账号只选择共享浏览器配置，语言、时区和网络不在向导内另存副本。

import { desktopText } from "../locale/text"
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
  profilesLoading?: boolean | undefined
  profilesError?: string | null
  proxies: PoolProxy[]
  account?: ClaudeAccountView | null | undefined
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
  const [name, setName] = useState(
    state.accountName || account?.displayName || desktopText("flows.authorize-screen.1"),
  )
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
      ? desktopText("flows.authorize-screen.2")
      : selecting
        ? desktopText("flows.authorize-screen.3")
        : state.step === "exit"
          ? desktopText("flows.authorize-screen.4")
          : state.step === "waiting"
            ? desktopText("flows.authorize-screen.5")
            : desktopText("flows.authorize-screen.6")
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
          {desktopText("flows.authorize-screen.7")}
        </Button>
      </div>
      <main className="win-body">
        <div className="wiz">
          <div className="wizard-progress">
            <span>
              {account
                ? desktopText("flows.authorize-screen.8")
                : desktopText("flows.authorize-screen.9")}
            </span>
            <span>
              {selecting
                ? desktopText("flows.authorize-screen.10")
                : state.step === "name"
                  ? desktopText("flows.authorize-screen.11")
                  : state.step === "exit"
                    ? desktopText("flows.authorize-screen.12")
                    : state.step === "waiting"
                      ? desktopText("flows.authorize-screen.13")
                      : desktopText("flows.authorize-screen.14")}
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
              <p className="wiz-desc">{desktopText("flows.authorize-screen.15")}</p>
              <div className="field">
                <label htmlFor="authorize-name">{desktopText("flows.authorize-screen.16")}</label>
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
                  {desktopText("flows.authorize-screen.17")}
                </Button>
              </div>
            </>
          ) : null}
          {selecting ? (
            <>
              <p className="wiz-desc">{desktopText("flows.authorize-screen.18")}</p>
              {profilesLoading ? (
                <p className="note">{desktopText("flows.authorize-screen.19")}</p>
              ) : null}
              {!profilesLoading && !profiles.length ? (
                <p className="note">{desktopText("flows.authorize-screen.20")}</p>
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
                            desktopText("flows.authorize-screen.21"))
                          : desktopText("flows.authorize-screen.22")}{" "}
                        · {profile.boundAccounts.length}
                        {desktopText("flows.authorize-screen.23")}
                      </span>
                    </span>
                  </Button>
                ))}
              {account && !profilesLoading && !selected ? (
                <p className="error-text" role="alert">
                  {desktopText("flows.authorize-screen.24")}
                </p>
              ) : null}
              <div className="wizard-foot">
                <Button variant="ghost" onClick={onOpenProfiles}>
                  {desktopText("flows.authorize-screen.25")}
                </Button>
                <Button
                  variant="primary"
                  disabled={!selected || profilesLoading}
                  onClick={() => {
                    if (selected)
                      onEvent({ type: "select-browser-profile", browserProfileId: selected.id })
                  }}
                >
                  {desktopText("flows.authorize-screen.26")}
                </Button>
              </div>
            </>
          ) : null}
          {state.step === "exit" ? (
            <>
              <p className="wiz-desc">{desktopText("flows.authorize-screen.27")}</p>
              <div className="group">
                <div className="item">
                  <span className="main">{desktopText("flows.authorize-screen.28")}</span>
                  <span>{selected?.name ?? desktopText("flows.authorize-screen.29")}</span>
                </div>
                <div className="item">
                  <span className="main">{desktopText("flows.authorize-screen.30")}</span>
                  <span>
                    {selected?.proxyId
                      ? (proxy?.name ?? desktopText("flows.authorize-screen.31"))
                      : desktopText("flows.authorize-screen.32")}
                  </span>
                </div>
                <div className="item">
                  <span className="main">{desktopText("flows.authorize-screen.33")}</span>
                  <span>
                    {selected?.fingerprint.lang} · {selected?.fingerprint.timezone}
                  </span>
                </div>
              </div>
              <div className="wizard-foot">
                <Button variant="ghost" onClick={() => onEvent({ type: "back" })}>
                  {desktopText("flows.authorize-screen.34")}
                </Button>
                <Button variant="primary" disabled={!selected} onClick={start}>
                  {desktopText("flows.authorize-screen.35")}
                </Button>
              </div>
            </>
          ) : null}
          {state.step === "waiting" ? (
            <>
              <p className="wiz-desc">{desktopText("flows.authorize-screen.36")}</p>
              <p className="note">{desktopText("flows.authorize-screen.37")}</p>
              <div className="wizard-foot">
                <Button variant="secondary" onClick={start}>
                  {desktopText("flows.authorize-screen.38")}
                </Button>
                <Button variant="ghost" onClick={onCancel}>
                  {desktopText("flows.authorize-screen.39")}
                </Button>
              </div>
            </>
          ) : null}
          {state.step === "completed" ? (
            <>
              <p className="wiz-desc">{desktopText("flows.authorize-screen.40")}</p>
              <div className="wizard-foot">
                <Button variant="primary" onClick={onCancel}>
                  {desktopText("flows.authorize-screen.41")}
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
