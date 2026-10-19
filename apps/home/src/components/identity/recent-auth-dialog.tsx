// 负责近期身份核验表单；proof 仅保留在服务器，所有结果由父级当前 owner 处理。
"use client"
import { useState, type FormEvent } from "react"
import type { LinkedIdentity, SensitiveOperation } from "@pigclaude/api/home/identity"
import { Button } from "@pigclaude/web-ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@pigclaude/web-ui/components/dialog"
import { Input } from "@pigclaude/web-ui/components/input"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import { homeClient } from "@/lib/api"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import {
  identityManagement,
  identityManagementNavigation,
  identityProviderNames,
} from "./identity-management"
const loadConfig = () => homeClient.get<CaptchaConfig>("/v1/auth/captcha")
/** 共享核验组件支持身份/设备精确目标，社交仅展示服务器已绑定列表。 */
export function RecentAuthDialog({
  action,
  identities,
  pending,
  error,
  onRun,
  onVerified,
  onClose,
}: {
  action: SensitiveOperation
  identities: LinkedIdentity[]
  pending: boolean
  error?: string | null
  onRun: (request: (isCurrent: () => boolean) => Promise<void>) => void
  onVerified: (isCurrent: () => boolean) => Promise<void>
  onClose: () => void
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>近期身份核验</DialogTitle>
        <DialogDescription>
          使用当前账号的密码或已绑定登录方式核验。本次核验只适用于所选操作，五分钟内有效且只能使用一次。
        </DialogDescription>
        {error && (
          <p role="alert" className="query-error">
            {error}
          </p>
        )}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="recent-password">当前密码</label>
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
        {identities.map(({ provider }) => (
          <Button
            key={provider}
            variant="outline"
            disabled={pending}
            onClick={() =>
              onRun(async (isCurrent) => {
                const result = await identityManagement.provider(action, provider, isCurrent)
                if (isCurrent() && result.type === "redirect")
                  identityManagementNavigation.assign(result.redirect)
              })
            }
          >
            使用已绑定 {identityProviderNames[provider]} 核验
          </Button>
        ))}
        <p>
          已从供应商返回？继续后将由服务器检查本次操作的核验状态。供应商核验不保证重新输入密码或
          MFA。
        </p>
        <Button variant="outline" disabled={pending} onClick={() => onRun(onVerified)}>
          使用已有核验继续
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          取消
        </Button>
      </DialogContent>
    </Dialog>
  )
}
