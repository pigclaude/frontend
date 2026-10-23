// 负责支付配置字段与局部秘密输入，保存直接命令并在销毁时清空秘密引用。
import { useEffect, useRef, useState } from "react"
import type {
  PaymentSettingsView,
  SavePaymentSettings,
} from "@pigclaude/api/membership/payment-settings"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { PayTypeCards } from "./pay-type-cards"
import { PaymentStatusBanner } from "./payment-status-banner"
import { SecretField } from "./payment-secret-field"
import { SettingRow, SettingSection } from "./setting-row"
/** 密钥仅存于当前表单 ref 和短时命令，不放入查询或 mutation 状态。 */
export function PaymentSettingsForm({
  view,
  canWrite,
  busy,
  refreshFailed,
  onSave,
  onDirtyChange,
}: {
  view: PaymentSettingsView
  canWrite: boolean
  busy: boolean
  refreshFailed: boolean
  onSave: (body: SavePaymentSettings) => Promise<PaymentSettingsView>
  onDirtyChange: (dirty: boolean) => void
}) {
  const [enabled, setEnabled] = useState(view.enabled)
  const [gatewayUrl, setGatewayUrl] = useState(view.gatewayUrl)
  const [pid, setPid] = useState(view.pid)
  const [notifyBaseUrl, setNotifyBaseUrl] = useState(view.notifyBaseUrl)
  const [payTypes, setPayTypes] = useState(view.payTypes)
  const secret = useRef("")
  const [secretVersion, setSecretVersion] = useState(0)
  const [resetSignal, setResetSignal] = useState(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      secret.current = ""
    }
  }, [])
  const dirty =
    enabled !== view.enabled ||
    gatewayUrl !== view.gatewayUrl ||
    pid !== view.pid ||
    notifyBaseUrl !== view.notifyBaseUrl ||
    JSON.stringify(payTypes) !== JSON.stringify(view.payTypes) ||
    secret.current !== ""
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange, secretVersion])
  const disabled = !canWrite || busy || refreshFailed
  function reset() {
    setEnabled(view.enabled)
    setGatewayUrl(view.gatewayUrl)
    setPid(view.pid)
    setNotifyBaseUrl(view.notifyBaseUrl)
    setPayTypes(view.payTypes)
    secret.current = ""
    setSecretVersion((v) => v + 1)
    setResetSignal((v) => v + 1)
  }
  async function save() {
    if (disabled || !dirty) return
    try {
      await onSave({
        expectedRevision: view.revision,
        enabled,
        gatewayUrl,
        pid,
        notifyBaseUrl,
        payTypes,
        ...(secret.current.trim() ? { key: secret.current } : {}),
      })
      if (alive.current) {
        secret.current = ""
        setSecretVersion((v) => v + 1)
        setResetSignal((v) => v + 1)
        onDirtyChange(false)
      }
    } catch {
      /* 保留局部输入供重试，hook 只显示固定错误。 */
    }
  }
  return (
    <section className="rounded-xl border p-5">
      <h2>易支付 · 版本 {view.revision}</h2>
      <PaymentStatusBanner view={view} />
      <SettingSection title="网关">
        <SettingRow title="启用支付" labelId="payment-enabled" inline>
          <Switch
            aria-labelledby="payment-enabled"
            checked={enabled}
            disabled={disabled}
            onCheckedChange={setEnabled}
          />
        </SettingRow>
        <SettingRow
          title="网关地址"
          labelFor="payment-gateway"
          hint="易支付网关根地址，必须是 https"
        >
          <Input
            id="payment-gateway"
            disabled={disabled}
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
          />
        </SettingRow>
        <SettingRow title="PID" labelFor="payment-pid" hint="易支付商户号">
          <Input
            id="payment-pid"
            disabled={disabled}
            value={pid}
            onChange={(e) => setPid(e.target.value)}
          />
        </SettingRow>
        <SettingRow title="密钥" labelFor="payment-key" hint="商户密钥，加密保存，不会回显">
          <SecretField
            configured={view.keyConfigured}
            disabled={disabled}
            resetSignal={resetSignal}
            onChange={(value) => {
              secret.current = value
              if (alive.current) setSecretVersion((v) => v + 1)
            }}
          />
        </SettingRow>
      </SettingSection>
      <SettingSection title="支付方式">
        <PayTypeCards value={payTypes} disabled={disabled} onChange={setPayTypes} />
      </SettingSection>
      <SettingSection title="回调">
        <SettingRow
          title="回调站点地址"
          labelFor="payment-notify"
          hint="用于接收支付结果通知的站点外部地址"
        >
          <Input
            id="payment-notify"
            disabled={disabled}
            value={notifyBaseUrl}
            onChange={(e) => setNotifyBaseUrl(e.target.value)}
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
    </section>
  )
}
