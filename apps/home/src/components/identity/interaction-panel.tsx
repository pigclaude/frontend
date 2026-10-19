// 负责按服务器交互阶段呈现中央身份页面，独立于 Home RP 会话。
"use client"
import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ApiError } from "@pigclaude/api/client"
import { Button } from "@pigclaude/web-ui/components/button"
import { PasswordInteraction } from "./password-interaction"
import { ProviderButtons } from "./provider-buttons"
import { DeviceApproval } from "./device-approval"
import {
  identityApi,
  identityErrorMessage,
  identityNavigation,
  type IdentityContinuation,
  type IdentityInteraction,
} from "@/lib/identity-api"

/** 从原浏览器交互恢复 CSRF 与 realm；每个页面实例只处理当前有效请求。 */
export function InteractionPanel() {
  const params = useSearchParams()
  const providerError = params.get("error")
  const id = params.get("interactionId") ?? ""
  const realm = params.get("realm") === "Admin" ? "Admin" : "User"
  const [view, setView] = useState<IdentityInteraction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [reload, setReload] = useState(0)
  const inFlight = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    const current = ++generation.current
    setView(null)
    setError(null)
    if (!id) {
      setError("登录交互缺失，请重新发起登录")
      return
    }
    void identityApi.load(id, realm).then(
      (interaction) => {
        if (current === generation.current) {
          setView(interaction)
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
        if (current === generation.current) setError(identityErrorMessage(reason))
      },
    )
    return () => {
      generation.current += 1
    }
  }, [id, realm, reload, providerError])
  function continueWith(result: IdentityContinuation) {
    if (result.type === "redirect") identityNavigation.assign(result.redirect)
    else {
      setView(result.interaction)
      setError(null)
    }
  }
  async function act(request: () => Promise<IdentityContinuation>) {
    if (inFlight.current) return
    const current = generation.current
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const result = await request()
      if (current === generation.current) continueWith(result)
    } catch (reason) {
      if (current === generation.current) setError(identityErrorMessage(reason))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  const expired = view !== null && view.expiresAt * 1000 <= Date.now()
  if (!view)
    return (
      <section className="flex w-full max-w-[400px] flex-col gap-4">
        {error ? (
          <>
            <p role="alert" className="query-error">
              {error}
            </p>
            <Button onClick={() => setReload((value) => value + 1)}>重试</Button>
            <a href="/login">返回登录</a>
          </>
        ) : (
          <p role="status">正在读取登录交互…</p>
        )}
      </section>
    )
  return (
    <section className="flex w-full max-w-[400px] flex-col gap-6" aria-labelledby="identity-title">
      <h1 id="identity-title" className="text-center text-xl font-semibold">
        {view.realm === "Admin"
          ? "管理员登录"
          : view.phase === "login"
            ? "登录 PigClaude"
            : view.phase === "device_approval"
              ? "确认设备授权"
              : "确认登录授权"}
      </h1>
      {expired ? (
        <p role="alert">登录交互已过期，请重新发起登录</p>
      ) : (
        <>
          {view.phase === "login" && (
            <>
              <PasswordInteraction
                key={view.interactionId}
                interaction={view}
                onContinue={continueWith}
                disabled={pending}
              />
              <ProviderButtons
                interaction={view}
                disabled={pending}
                onStart={(provider) => {
                  void act(() => identityApi.provider(view, provider))
                }}
              />
            </>
          )}
          {view.phase === "consent" && (
            <div className="flex flex-col gap-4">
              <p>是否允许{view.realm === "Admin" ? "管理站" : "用户站"}使用本次登录身份？</p>
              <Button
                disabled={pending}
                onClick={() => {
                  void act(() => identityApi.decide(view, "consent"))
                }}
              >
                同意并继续
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  void act(() => identityApi.decide(view, "deny"))
                }}
              >
                拒绝
              </Button>
            </div>
          )}
          {view.phase === "device_approval" && (
            <DeviceApproval
              key={`${view.interactionId}:${view.device?.bindingEpoch}`}
              interaction={view}
              disabled={pending}
              onApprove={(reauthorize) => {
                void act(() => identityApi.approveDevice(view, reauthorize))
              }}
              onDeny={() => {
                void act(() => identityApi.decide(view, "deny"))
              }}
            />
          )}
        </>
      )}
      {error && (
        <p role="alert" className="query-error">
          {error}
        </p>
      )}
    </section>
  )
}
