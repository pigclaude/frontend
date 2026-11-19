// 负责按服务器交互阶段呈现中央身份页面，独立于 Home RP 会话。
"use client"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ApiError } from "@pigclaude/api/client"
import { consumeRegistrationHint } from "@pigclaude/api/web-oidc"
import { Button } from "@pigclaude/web-ui/components/button"
import { LineIcon } from "@pigclaude/web-ui/components/line-icon"
import { PigclaudeMark } from "@pigclaude/web-ui/components/pigclaude-mark"
import { LoginForm, type LoginMode } from "./login-form"
import { PasswordResetForm } from "./password-reset-form"
import { ProviderButtons } from "./provider-buttons"
import { DeviceApproval } from "./device-approval"
import { ConsentApproval } from "./consent-approval"
import { ExpiredNotice } from "./expired-notice"
import {
  identityApi,
  identityErrorMessage,
  identityNavigation,
  type IdentityContinuation,
  type IdentityInteraction,
} from "@/lib/identity-api"
import { createIdentityInteractionRequests } from "@/lib/identity-interaction-requests"

const alertClass =
  "rounded-md border border-[color-mix(in_oklab,var(--danger),transparent_65%)] bg-[color-mix(in_oklab,var(--danger),transparent_94%)] px-3 py-2.5 text-[13px] leading-5 text-[var(--danger-ink)]"

/** 从原浏览器交互恢复 CSRF 与 realm；每个页面实例只处理当前有效请求。 */
export function InteractionPanel() {
  const params = useSearchParams()
  const providerError = params.get("error")
  const id = params.get("interactionId") ?? ""
  const realm = params.get("realm") === "Admin" ? "Admin" : "User"
  return (
    <InteractionSession
      key={JSON.stringify([id, realm, providerError])}
      id={id}
      realm={realm}
      providerError={providerError}
    />
  )
}

// 每个路由交互独立拥有加载、mutation 与清理生命周期，旧 Promise 无法接管新子树。
function InteractionSession({
  id,
  realm,
  providerError,
}: {
  id: string
  realm: "User" | "Admin"
  providerError: string | null
}) {
  const [view, setView] = useState<IdentityInteraction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [membershipRequired, setMembershipRequired] = useState(false)
  const [pending, setPending] = useState<"password" | "other" | null>(null)
  const [reload, setReload] = useState(0)
  const [mode, setMode] = useState<LoginMode>("login")
  // 忘记密码复用当前登录交互；完成后只带回邮箱和成功提示，不创建会话。
  const [resetting, setResetting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [prefillEmail, setPrefillEmail] = useState("")
  const requests = useMemo(() => view && createIdentityInteractionRequests(view), [view])
  const hintRead = useRef(false)
  const mutationOwner = useRef<symbol | null>(null)
  const generation = useRef(0)
  const mounted = useRef(false)
  // 切换账号失败后重读交互时保留的错误；重读期间沿用旧视图并禁用操作，避免闪回加载页。
  const carriedError = useRef<string | null>(null)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      // 在卸载 commit 内撤销归属，不等待 passive cleanup 才阻止旧 Promise。
      mounted.current = false
      generation.current += 1
      mutationOwner.current = null
    }
  }, [])
  useEffect(() => {
    const current = ++generation.current
    const carried = carriedError.current
    carriedError.current = null
    mutationOwner.current = null
    setPending(carried === null ? null : "other")
    if (carried === null) setView(null)
    setError(carried)
    setMembershipRequired(false)
    if (!id) {
      setError("登录交互缺失，请重新发起登录")
      return
    }
    void identityApi.load(id, realm).then(
      (interaction) => {
        if (current === generation.current) {
          setView(interaction)
          setPending(null)
          if (
            providerError &&
            [
              "ACCOUNT_BANNED",
              "ACCOUNT_LINK_REQUIRED",
              "VERIFIED_EMAIL_REQUIRED",
              "FEDERATION_UNAVAILABLE",
              "FEDERATION_REJECTED",
            ].includes(providerError)
          )
            setError(identityErrorMessage(new ApiError(400, { app_error: providerError })))
        }
      },
      (reason: unknown) => {
        if (current === generation.current) {
          setView(null)
          setPending(null)
          setError(identityErrorMessage(reason))
        }
      },
    )
    return () => {
      generation.current += 1
      mutationOwner.current = null
    }
  }, [id, realm, reload, providerError])
  const registrable =
    view !== null && view.phase === "login" && view.realm === "User" && view.registrationAllowed
  useLayoutEffect(() => {
    // 注册直达提示只在可注册的 User 登录阶段读取一次，绘制前切换以免先闪出登录布局。
    if (!registrable || hintRead.current) return
    hintRead.current = true
    if (consumeRegistrationHint()) setMode("register")
  }, [registrable])
  function continueWith(result: IdentityContinuation) {
    if (result.type === "redirect") identityNavigation.assign(result.redirect)
    else {
      setView(result.interaction)
      setError(null)
    }
  }
  async function act(
    request: (interaction: IdentityInteraction) => Promise<IdentityContinuation>,
    kind: "password" | "other" = "other",
    hooks: {
      onResult?: (result: IdentityContinuation) => void
      onError?: (message: string) => void
    } = {},
  ) {
    if (!requests || !mounted.current || mutationOwner.current !== null) return
    // 在任何异步验证码/HTTP操作开始前捕获生命周期和唯一 owner。
    const current = generation.current
    const owner = Symbol()
    mutationOwner.current = owner
    const ownsMutation = () =>
      mounted.current && current === generation.current && mutationOwner.current === owner
    setPending(kind)
    setError(null)
    setMembershipRequired(false)
    try {
      const result = await requests.run((interaction) =>
        ownsMutation() ? request(interaction) : Promise.resolve(null),
      )
      if (result && ownsMutation()) {
        continueWith(result)
        hooks.onResult?.(result)
      }
    } catch (reason) {
      if (ownsMutation()) {
        const message = identityErrorMessage(reason)
        setError(message)
        setMembershipRequired(reason instanceof ApiError && reason.code === "membership_required")
        hooks.onError?.(message)
      }
    } finally {
      // 旧请求不能清除新交互、新重试或新 mutation 的 pending。
      if (ownsMutation()) {
        mutationOwner.current = null
        setPending(null)
      }
    }
  }
  const deadline = requests?.renewOnExpiry ? undefined : view?.expiresAt
  const [, rerenderAtDeadline] = useState(0)
  useEffect(() => {
    // 需要回到原入口的交互到期时立即显示提示。
    if (deadline === undefined) return
    const remaining = deadline * 1000 - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(
      () => rerenderAtDeadline((value) => value + 1),
      Math.min(remaining, 2_147_483_647),
    )
    return () => window.clearTimeout(timer)
  }, [deadline])
  const expired = deadline !== undefined && deadline * 1000 <= Date.now()
  if (!view || !requests)
    return (
      <section className="flex w-full max-w-[400px] flex-col gap-4">
        {error ? (
          <>
            <p role="alert" className="query-error">
              {error}
            </p>
            <Button onClick={() => setReload((value) => value + 1)}>重试</Button>
            {realm === "User" ? (
              <a href="/login">返回登录</a>
            ) : (
              <p className="text-sm text-muted-foreground">请回到管理后台重新登录</p>
            )}
          </>
        ) : (
          <p role="status">正在读取登录交互…</p>
        )}
      </section>
    )
  if (view.phase === "login") {
    const admin = view.realm === "Admin"
    const resettingPassword = !admin && resetting
    const register = !admin && view.registrationAllowed && mode === "register"
    return (
      <section
        className="relative flex w-full max-w-[360px] flex-col"
        aria-labelledby="identity-title"
      >
        <header className="flex flex-col gap-1.5">
          <h1 id="identity-title" className="text-xl font-semibold tracking-tight">
            {admin
              ? "登录管理后台"
              : resettingPassword
                ? "重设密码"
                : register
                  ? "注册 PigClaude"
                  : "登录 PigClaude"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {admin
              ? "仅限运营人员使用管理员账号"
              : resettingPassword
                ? "用邮箱验证码设置新密码"
                : "管理会员和桌面设备"}
          </p>
        </header>
        {error && !expired && (
          <p role="alert" className={`mt-5 ${alertClass}`}>
            {error}
          </p>
        )}
        {expired ? (
          <ExpiredNotice restartUrl={view.restartUrl} className={alertClass} />
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            {resettingPassword ? (
              <PasswordResetForm
                interaction={view}
                runRequest={requests.run}
                disabled={pending !== null}
                onCancel={() => setResetting(false)}
                onDone={(email) => {
                  setResetting(false)
                  setMode("login")
                  setNotice("密码已重设，请用新密码登录")
                  setPrefillEmail(email)
                }}
              />
            ) : (
              <>
                <ProviderButtons
                  interaction={view}
                  disabled={pending !== null}
                  onStart={(provider) => {
                    void act((interaction) => identityApi.provider(interaction, provider))
                  }}
                />
                <LoginForm
                  key={view.interactionId}
                  interaction={view}
                  runRequest={requests.run}
                  mode={mode}
                  initialEmail={prefillEmail}
                  notice={notice}
                  onModeChange={setMode}
                  onForgotPassword={() => {
                    setError(null)
                    setNotice(null)
                    setResetting(true)
                  }}
                  onMutate={(request) => {
                    void act(request, "password")
                  }}
                  pending={pending === "password"}
                  disabled={pending !== null}
                />
              </>
            )}
          </div>
        )}
      </section>
    )
  }
  const device = view.phase === "device_approval"
  return (
    <section className="flex w-full max-w-[380px] flex-col" aria-labelledby="identity-title">
      <header className="flex flex-col items-center gap-1.5 text-center">
        {device && (
          <div aria-hidden="true" className="mb-4 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[10px] border border-border bg-[var(--card-bg)] text-[var(--fg-2)] shadow-[var(--card-shadow)]">
              <LineIcon name="monitor" className="size-5" />
            </span>
            <LineIcon name="swap" className="size-4 text-[var(--meta)]" />
            <span className="flex size-10 items-center justify-center rounded-[10px] border border-border bg-[var(--card-bg)] text-foreground shadow-[var(--card-shadow)]">
              <PigclaudeMark tone="brand" className="size-6" />
            </span>
          </div>
        )}
        <h1 id="identity-title" className="text-xl font-semibold tracking-tight">
          {device ? "授权 PigClaude 桌面端" : "确认登录授权"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {device
            ? "这台设备将登录到你的账号"
            : `是否允许${view.realm === "Admin" ? "管理站" : "用户站"}使用本次登录身份？`}
        </p>
      </header>
      {error && !expired && (
        <p role="alert" className={`mt-5 ${alertClass}`}>
          {error}
          {device && membershipRequired && (
            <>
              {" "}
              <a
                href="/membership"
                className="font-medium text-[var(--accent-ink)] underline-offset-4 hover:underline"
              >
                开通会员
              </a>
            </>
          )}
        </p>
      )}
      {expired ? (
        <ExpiredNotice restartUrl={view.restartUrl} className={alertClass} />
      ) : (
        <div className="mt-6">
          {view.phase === "consent" && (
            <ConsentApproval
              interaction={view}
              disabled={pending !== null}
              onConsent={() => {
                void act((interaction) => identityApi.decide(interaction, "consent"))
              }}
              onDeny={() => {
                void act((interaction) => identityApi.decide(interaction, "deny"))
              }}
            />
          )}
          {device && (
            <DeviceApproval
              key={`${view.interactionId}:${view.device?.bindingEpoch}`}
              interaction={view}
              disabled={pending !== null}
              onApprove={(reauthorize) => {
                void act((interaction) => identityApi.approveDevice(interaction, reauthorize))
              }}
              onDeny={() => {
                void act((interaction) => identityApi.decide(interaction, "deny"))
              }}
              onSwitchAccount={() => {
                void act(identityApi.switchAccount, "other", {
                  // 换号后回到登录表单，不沿用之前切到的注册布局。
                  onResult: (result) => {
                    if (result.type === "require_login") setMode("login")
                  },
                  // 后端可能已在失败前重置交互；重读权威视图并保留错误提示。
                  onError: (message) => {
                    carriedError.current = message
                    setReload((value) => value + 1)
                  },
                })
              }}
            />
          )}
        </div>
      )}
    </section>
  )
}
