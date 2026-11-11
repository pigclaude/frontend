// 负责邮件配置字段、加密端口建议、授权码输入和带原因映射的测试发信。
import { useEffect, useRef, useState } from "react"
import { ApiError } from "@pigclaude/api/client"
import type { MailSettingsView, SaveMailSettings } from "@pigclaude/api/admin/mail-settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SettingRow, SettingSection } from "./setting-row"
import { SecretInput } from "./secret-field"
const DEFAULT_HOST = "smtp.exmail.qq.com"
const SUGGESTED_PORTS = { ssl: "465", starttls: "587" } as const
const TEST_FAILURES: Record<string, string> = {
  auth: "认证失败：检查邮箱地址和授权码",
  connect: "连接失败：检查主机和端口",
  rejected: "对方拒收",
  timeout: "连接超时",
  not_configured: "请先保存并启用",
}
/** 测试发信只翻译服务端固定原因，未知错误不透出响应细节。 */
export function mailTestFailureMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.code === "MAIL_TEST_FAILED")
    return TEST_FAILURES[cause.metadata.reason] ?? "测试邮件发送失败，请稍后重试"
  return "测试邮件发送失败，请稍后重试"
}
/** 新配置预填腾讯企业邮箱默认值，已保存配置按原值回填。 */
export function MailSettingsForm({
  view,
  canWrite,
  busy,
  refreshFailed,
  onSave,
  onSendTest,
  onDirtyChange,
}: {
  view: MailSettingsView
  canWrite: boolean
  busy: boolean
  refreshFailed: boolean
  onSave: (body: SaveMailSettings) => Promise<MailSettingsView>
  onSendTest: (to: string) => Promise<void>
  onDirtyChange: (dirty: boolean) => void
}) {
  const isNew = view.revision === "0"
  const initialHost = isNew && !view.host ? DEFAULT_HOST : view.host
  const initialPort =
    isNew && view.port === 0 ? SUGGESTED_PORTS[view.encryption] : String(view.port)
  const [enabled, setEnabled] = useState(view.enabled)
  const [host, setHost] = useState(initialHost)
  const [port, setPort] = useState(initialPort)
  const [encryption, setEncryption] = useState<"ssl" | "starttls">(view.encryption)
  const [username, setUsername] = useState(view.username)
  const [password, setPassword] = useState("")
  const [fromName, setFromName] = useState(view.fromName)
  const [fromAddress, setFromAddress] = useState(view.fromAddress || view.username)
  const [testOpen, setTestOpen] = useState(false)
  const [recipient, setRecipient] = useState("")
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const portEdited = useRef(false)
  const fromAddressEdited = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const dirty =
    enabled !== view.enabled ||
    host !== initialHost ||
    port !== initialPort ||
    encryption !== view.encryption ||
    username !== view.username ||
    password !== "" ||
    fromName !== view.fromName ||
    fromAddress !== (view.fromAddress || view.username)
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  const disabled = !canWrite || busy || refreshFailed
  function reset() {
    setEnabled(view.enabled)
    setHost(initialHost)
    setPort(initialPort)
    setEncryption(view.encryption)
    setUsername(view.username)
    setPassword("")
    setFromName(view.fromName)
    setFromAddress(view.fromAddress || view.username)
    portEdited.current = false
    fromAddressEdited.current = false
  }
  function changeEncryption(next: "ssl" | "starttls") {
    setEncryption(next)
    if (!portEdited.current) setPort(SUGGESTED_PORTS[next])
  }
  function changeUsername(value: string) {
    setUsername(value)
    if (!fromAddressEdited.current) setFromAddress(value)
  }
  async function save() {
    if (disabled || !dirty) return
    try {
      await onSave({
        expectedRevision: view.revision,
        enabled,
        host,
        port: Number(port),
        encryption,
        username,
        fromName,
        fromAddress,
        ...(password.trim() ? { password } : {}),
      })
      if (alive.current) {
        setPassword("")
        onDirtyChange(false)
      }
    } catch {
      /* 保留局部输入供重试，hook 只显示固定错误。 */
    }
  }
  async function sendTest() {
    if (disabled || dirty || !recipient.trim()) return
    setTestMessage(null)
    try {
      await onSendTest(recipient.trim())
      if (alive.current) {
        setTestMessage({ ok: true, text: "测试邮件已发送" })
        setRecipient("")
      }
    } catch (cause) {
      if (alive.current) setTestMessage({ ok: false, text: mailTestFailureMessage(cause) })
    }
  }
  return (
    <section className="rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>邮件发送 · 版本 {view.revision}</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || dirty}
          onClick={() => {
            setTestMessage(null)
            setTestOpen(true)
          }}
        >
          发送测试邮件
        </Button>
      </div>
      <SettingSection title="SMTP 服务器">
        <SettingRow title="启用邮件发送" labelId="mail-enabled" inline>
          <Switch
            aria-labelledby="mail-enabled"
            checked={enabled}
            disabled={disabled}
            onCheckedChange={setEnabled}
          />
        </SettingRow>
        <SettingRow title="SMTP 主机" labelFor="mail-host" hint="腾讯企业邮箱为 smtp.exmail.qq.com">
          <Input
            id="mail-host"
            disabled={disabled}
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </SettingRow>
        <SettingRow title="端口" labelFor="mail-port" hint="SSL 通常为 465，STARTTLS 通常为 587">
          <Input
            id="mail-port"
            type="number"
            inputMode="numeric"
            disabled={disabled}
            value={port}
            onChange={(event) => {
              portEdited.current = true
              setPort(event.target.value)
            }}
          />
        </SettingRow>
        <SettingRow title="加密方式" labelId="mail-encryption" hint="只允许 TLS 加密连接">
          <ToggleGroup
            type="single"
            value={encryption}
            disabled={disabled}
            aria-labelledby="mail-encryption"
            onValueChange={(next) => {
              if (next === "ssl" || next === "starttls") changeEncryption(next)
            }}
          >
            <ToggleGroupItem value="ssl">SSL</ToggleGroupItem>
            <ToggleGroupItem value="starttls">STARTTLS</ToggleGroupItem>
          </ToggleGroup>
        </SettingRow>
        <SettingRow
          title="发信邮箱"
          labelFor="mail-username"
          hint="SMTP 登录用户名，通常是完整邮箱地址"
        >
          <Input
            id="mail-username"
            type="email"
            disabled={disabled}
            value={username}
            onChange={(event) => changeUsername(event.target.value)}
          />
        </SettingRow>
        <SettingRow
          title="授权码"
          labelFor="mail-password"
          badges={
            view.passwordConfigured ? (
              <Badge variant="success">已设置</Badge>
            ) : (
              <Badge variant="neutral">未设置</Badge>
            )
          }
          hint="加密保存、不会回显；留空保留已保存的授权码。"
        >
          <SecretInput
            id="mail-password"
            isSet={view.passwordConfigured}
            disabled={disabled}
            value={password}
            onChange={setPassword}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection title="发件人">
        <SettingRow title="发件人名称" labelFor="mail-from-name" hint="收件人看到的发件人名称">
          <Input
            id="mail-from-name"
            disabled={disabled}
            value={fromName}
            onChange={(event) => setFromName(event.target.value)}
          />
        </SettingRow>
        <SettingRow title="发件地址" labelFor="mail-from-address" hint="默认与发信邮箱相同">
          <Input
            id="mail-from-address"
            type="email"
            disabled={disabled}
            value={fromAddress}
            onChange={(event) => {
              fromAddressEdited.current = true
              setFromAddress(event.target.value)
            }}
          />
        </SettingRow>
      </SettingSection>
      {dirty && (
        <div className="sticky bottom-0 flex items-center gap-3 rounded-lg border bg-background p-4">
          <span className="flex-1 text-sm">有未保存的修改</span>
          <Button disabled={disabled || !dirty} onClick={() => void save()}>
            保存
          </Button>
          <Button variant="outline" disabled={busy || !dirty} onClick={reset}>
            撤销
          </Button>
        </div>
      )}
      <Dialog
        open={testOpen}
        onOpenChange={(open) => {
          if (busy) return
          setTestOpen(open)
          if (!open) setTestMessage(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发送测试邮件</DialogTitle>
            <DialogDescription>使用已保存的 SMTP 配置发送一封测试邮件。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mail-test-to" className="text-[13px] font-medium text-foreground">
              收件地址
            </label>
            <Input
              id="mail-test-to"
              type="email"
              disabled={busy}
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </div>
          {testMessage && (
            <p
              role={testMessage.ok ? "status" : "alert"}
              className={testMessage.ok ? "text-sm text-success-ink" : "text-sm text-danger-ink"}
            >
              {testMessage.text}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setTestOpen(false)}>
              取消
            </Button>
            <Button disabled={busy || !recipient.trim()} onClick={() => void sendTest()}>
              发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
