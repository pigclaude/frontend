// 负责沿用固定 Pigcursor 设置卡片与行布局，分离保存草稿、proof 启用和显式关闭。
import { useCallback, useEffect, useState } from "react"
import { ShieldCheck, CircleCheck, Save, RotateCcw } from "lucide-react"
import type { CaptchaConfig } from "@pigclaude/contracts/captcha"
import type {
  SaveTurnstileDraft,
  SecuritySettingsView,
} from "@pigclaude/contracts/security-settings"
import { useTurnstileCaptcha } from "@pigclaude/web-ui/hooks/use-turnstile-captcha"
import { TurnstileCaptcha } from "@pigclaude/web-ui/components/turnstile-captcha"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@pigclaude/web-ui/components/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@pigclaude/web-ui/components/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SettingRow, SettingSection } from "./setting-row"
import { SecretBadges, SecretInput } from "./secret-field"
interface Props {
  view: SecuritySettingsView
  canWrite: boolean
  busy: boolean
  refreshFailed: boolean
  onDirtyChange: (dirty: boolean) => void
  onSave: (body: SaveTurnstileDraft) => Promise<SecuritySettingsView>
  onActivate: (proof: string) => Promise<SecuritySettingsView>
  onDisable: () => Promise<SecuritySettingsView>
}
/** 只有已加载的服务端快照才能初始化表单；秘密仅存在输入 state 和短时请求。 */
export function TurnstileSettingsForm({
  view,
  canWrite,
  busy,
  refreshFailed,
  onDirtyChange,
  onSave,
  onActivate,
  onDisable,
}: Props) {
  const base = view.draft ?? view.active
  const [siteKey, setSiteKey] = useState(base.siteKey ?? "")
  const [hostnames, setHostnames] = useState(base.hostnames.join("\n"))
  const [enabled, setEnabled] = useState(base.enabled)
  const [secret, setSecret] = useState("")
  const [confirmDisable, setConfirmDisable] = useState(false)
  const dirty =
    siteKey !== (base.siteKey ?? "") ||
    hostnames !== base.hostnames.join("\n") ||
    enabled !== base.enabled ||
    secret !== ""
  const disabled = !canWrite || busy || refreshFailed
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  function cancel() {
    setSiteKey(base.siteKey ?? "")
    setHostnames(base.hostnames.join("\n"))
    setEnabled(base.enabled)
    setSecret("")
  }
  async function save() {
    if (disabled || !dirty) return
    try {
      await onSave({
        expectedRevision: view.revision,
        enabled,
        siteKey,
        hostnames: hostnames
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
        ...(secret ? { secretKey: secret } : {}),
      })
      setSecret("")
      onDirtyChange(false)
    } catch {
      /* 请求失败保留输入供重试，错误由 hook 展示。 */
    }
  }
  return (
    <div className="min-w-0 space-y-4">
      <section
        className="rounded-xl border border-border bg-[var(--card-bg)] p-5 text-xs text-meta"
        aria-label="生效配置"
      >
        <h2 className="text-sm font-medium text-foreground">
          当前生效配置 · 版本 {view.active.revision}
        </h2>
        <p className="mt-2 break-words">
          {view.active.enabled ? "已启用" : "已关闭"} · {view.active.mode} · Site Key：
          {view.active.siteKey ?? "未配置"}
        </p>
        <p className="mt-1 break-words">
          允许主机名：{view.active.hostnames.join("、") || "未配置"}
        </p>
        <p className="mt-1 break-words">
          {view.active.updatedAt} · {view.active.updatedBy}
        </p>
      </section>
      <Card className="animate-in duration-200 fade-in-0">
        <CardHeader className="border-b border-border-soft">
          <div className="flex items-start gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-raise-2 text-fg-2">
              <ShieldCheck className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <CardTitle>安全风控</CardTitle>
              <CardDescription className="mt-1 max-w-3xl leading-relaxed">
                保存为草稿，验证成功后才替换生效配置；Secret 加密存库、只写不回显。
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <div className="divide-y divide-border">
          <SettingSection>
            <SettingRow
              inline
              title="草稿启用验证"
              labelId="turnstile-enabled"
              hint="保存不会直接启用，关闭生效验证须使用下方独立确认。"
              dirty={enabled !== base.enabled}
            >
              <Switch
                aria-labelledby="turnstile-enabled"
                disabled={disabled}
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </SettingRow>
            <SettingRow
              title="Site Key"
              labelFor="turnstile-site-key"
              settingKey="siteKey"
              dirty={siteKey !== (base.siteKey ?? "")}
            >
              <Input
                id="turnstile-site-key"
                disabled={disabled}
                value={siteKey}
                onChange={(event) => setSiteKey(event.target.value)}
                className="font-mono"
              />
            </SettingRow>
            <SettingRow
              title="允许主机名"
              labelFor="turnstile-hostnames"
              settingKey="hostnames"
              hint="每行一个主机名，不含协议、路径或端口。启用时必须包含当前管理后台主机名。"
              dirty={hostnames !== base.hostnames.join("\n")}
            >
              <textarea
                id="turnstile-hostnames"
                disabled={disabled}
                value={hostnames}
                onChange={(event) => setHostnames(event.target.value)}
                className="min-h-24 w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm"
              />
            </SettingRow>
            <SettingRow
              title="Secret Key"
              labelFor="turnstile-secret"
              badges={<SecretBadges isSet={base.secretConfigured} />}
              hint="留空保留已保存的 Secret；保存成功或撤销时清空输入。"
              dirty={secret !== ""}
            >
              <SecretInput
                id="turnstile-secret"
                isSet={base.secretConfigured}
                disabled={disabled}
                value={secret}
                onChange={setSecret}
              />
            </SettingRow>
          </SettingSection>
        </div>
        <CardFooter className="sticky bottom-0 z-10 flex-wrap justify-between gap-4 bg-[color-mix(in_srgb,var(--card-elevated),transparent_8%)] backdrop-blur-md">
          <span className="flex items-center gap-1.5 text-xs text-meta">
            <CircleCheck className="size-3.5" />
            {refreshFailed
              ? "配置刷新失败，请刷新后再提交"
              : dirty
                ? "有未保存的修改"
                : view.draft
                  ? `已保存草稿 · 版本 ${view.draft.revision}`
                  : "已与生效配置一致"}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <Button variant="ghost" disabled={busy} onClick={cancel}>
                <RotateCcw />
                撤销修改
              </Button>
            )}
            <Button disabled={disabled || !dirty} onClick={() => void save()}>
              <Save />
              保存草稿
            </Button>
          </div>
        </CardFooter>
      </Card>
      {view.draft && (
        <CandidateActivation
          draft={view.draft}
          revision={view.revision}
          disabled={disabled || dirty}
          onActivate={onActivate}
        />
      )}
      <section className="rounded-xl border border-border bg-[var(--card-bg)] p-5">
        <h2 className="text-sm font-medium">关闭生效验证</h2>
        <p className="mt-2 mb-3 text-xs text-meta">独立操作，保留可复用的加密材料。</p>
        <Button
          variant="destructive"
          disabled={disabled || dirty || !view.active.enabled}
          onClick={() => setConfirmDisable(true)}
        >
          关闭验证
        </Button>
      </section>
      <Dialog
        open={confirmDisable}
        onOpenChange={(open) => {
          if (!busy) setConfirmDisable(open)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认关闭生效验证？</DialogTitle>
            <DialogDescription>
              关闭后认证接口不再要求验证码，已有加密材料仍保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmDisable(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                void onDisable().then(
                  () => setConfirmDisable(false),
                  () => {},
                )
              }}
            >
              确认关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
function CandidateActivation({
  draft,
  revision,
  disabled,
  onActivate,
}: {
  draft: SecuritySettingsView["active"]
  revision: string
  disabled: boolean
  onActivate: Props["onActivate"]
}) {
  const loadConfig = useCallback(async (): Promise<CaptchaConfig> => {
    if (!draft.enabled || !draft.siteKey) throw new Error("请先保存启用的完整草稿")
    return { enabled: true, provider: "turnstile", siteKey: draft.siteKey, mode: "required" }
  }, [draft.enabled, draft.siteKey, revision])
  const captcha = useTurnstileCaptcha({ loadConfig, action: "admin_login" })
  // 表单发生未保存修改后立即销毁 proof，不能沿用旧候选验证。
  const retry = captcha.retry
  useEffect(() => {
    if (disabled) retry()
  }, [disabled, retry])
  return (
    <section className="min-w-0 rounded-xl border border-border bg-[var(--card-bg)] p-5">
      <h2 className="text-sm font-medium">验证草稿并启用 · 版本 {revision}</h2>
      <p className="mt-2 mb-4 break-words text-xs text-meta">
        草稿 Site Key：{draft.siteKey ?? "未配置"} · 主机名：{draft.hostnames.join("、")}
      </p>
      {!disabled && <TurnstileCaptcha {...captcha.field} />}
      <Button
        className="mt-4"
        disabled={disabled || !captcha.ready || !draft.enabled}
        onClick={() => {
          void captcha.run((proof) => onActivate(proof ?? "")).catch(() => {})
        }}
      >
        验证并启用
      </Button>
    </section>
  )
}
