// 负责近期身份核验的表单内容：密码加人机验证，或跳转已绑定供应商；proof 只保留在服务器。
"use client"
import { useState, type FormEvent } from "react"
import type { LinkedIdentity, SensitiveOperation } from "@pigclaude/api/home/identity"
import { Button } from "@pigclaude/web-ui/components/button"
import { Input } from "@pigclaude/web-ui/components/input"
import { LineIcon } from "@pigclaude/web-ui/components/line-icon"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import { homeClient } from "@/lib/api"
import { savePending } from "@/lib/pending-sensitive-operation"
import {
  identityManagement,
  identityManagementNavigation,
  identityProviderNames,
} from "./identity-management"

const loadConfig = () => homeClient.get<CaptchaConfig>("/v1/auth/captcha")

/**
 * 核验表单。没有密码的账号不显示密码框，只能用已绑定的供应商；跳转供应商前记下当前操作，
 * 回来后由页面续接。所有请求都通过父级的 `onRun` 执行，结果归属由父级判断。
 */
export function RecentAuthForm({
  action,
  identities,
  hasPassword = true,
  pending,
  error,
  onRun,
  onVerified,
  onCancel,
}: {
  action: SensitiveOperation
  identities: LinkedIdentity[]
  hasPassword?: boolean
  pending: boolean
  error?: string | null
  onRun: (request: (isCurrent: () => boolean) => Promise<void>) => void
  onVerified: (isCurrent: () => boolean) => Promise<void>
  onCancel: () => void
}) {
  const [password, setPassword] = useState("")
  const captcha = useTurnstileCaptcha({ loadConfig, action: "home_login" })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!captcha.ready || pending || !password) return
    onRun(async (isCurrent) => {
      const result = await captcha.run((token) =>
        identityManagement.password(action, password, token, isCurrent),
      )
      // 下一次业务请求仍需服务器核验原 session/version/action 的一次性证明。
      if (isCurrent() && result.type === "verified") await onVerified(isCurrent)
    })
  }
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="query-error">
          {error}
        </p>
      )}
      {hasPassword && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="recent-password" className="text-[13px] font-medium">
            当前密码
          </label>
          <Input
            id="recent-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <TurnstileCaptcha {...captcha.field} />
          <Button type="submit" disabled={pending || !captcha.ready || !password}>
            核验并继续
          </Button>
        </form>
      )}
      {identities.map(({ provider }) => (
        <Button
          key={provider}
          variant="outline"
          disabled={pending}
          onClick={() =>
            onRun(async (isCurrent) => {
              const result = await identityManagement.provider(action, provider, isCurrent)
              if (isCurrent() && result.type === "redirect") {
                savePending(action)
                identityManagementNavigation.assign(result.redirect)
              }
            })
          }
        >
          <LineIcon name={provider} className="size-4" />
          使用已绑定 {identityProviderNames[provider]} 核验
        </Button>
      ))}
      <p className="text-[12.5px] text-muted-foreground">
        已从供应商返回？继续后将由服务器检查本次操作的核验状态。供应商核验不保证重新输入密码或 MFA。
      </p>
      <Button variant="outline" disabled={pending} onClick={() => onRun(onVerified)}>
        使用已有核验继续
      </Button>
      <Button variant="ghost" disabled={pending} onClick={onCancel}>
        取消
      </Button>
    </div>
  )
}
