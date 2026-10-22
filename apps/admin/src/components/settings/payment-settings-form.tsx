// 负责支付配置字段与局部秘密输入，保存直接命令并在销毁时清空秘密引用。
import { useEffect, useRef, useState } from "react"
import type {
  PaymentSettingsView,
  SavePaymentSettings,
} from "@pigclaude/api/membership/payment-settings"
import type { PayType } from "@pigclaude/api/membership/types"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
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
        onDirtyChange(false)
      }
    } catch {
      /* 保留局部输入供重试，hook 只显示固定错误。 */
    }
  }
  return (
    <section className="rounded-xl border p-5">
      <h2>易支付 · 版本 {view.revision}</h2>
      <SettingSection>
        <SettingRow title="启用支付" labelId="payment-enabled" inline>
          <Switch
            aria-labelledby="payment-enabled"
            checked={enabled}
            disabled={disabled}
            onCheckedChange={setEnabled}
          />
        </SettingRow>
        <SettingRow title="网关地址" labelFor="payment-gateway">
          <Input
            id="payment-gateway"
            disabled={disabled}
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
          />
        </SettingRow>
        <SettingRow title="PID" labelFor="payment-pid">
          <Input
            id="payment-pid"
            disabled={disabled}
            value={pid}
            onChange={(e) => setPid(e.target.value)}
          />
        </SettingRow>
        <SettingRow title="密钥" labelFor="payment-key">
          <Input
            id="payment-key"
            type="password"
            autoComplete="new-password"
            disabled={disabled}
            value={secret.current}
            placeholder={view.keyConfigured ? "已配置，留空则不修改" : "未配置"}
            onChange={(e) => {
              secret.current = e.target.value
              setSecretVersion((v) => v + 1)
            }}
          />
        </SettingRow>
        <SettingRow title="支付方式">
          <div className="flex gap-4">
            {(["alipay", "wxpay"] as PayType[]).map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={payTypes.includes(type)}
                  onChange={(e) =>
                    setPayTypes(
                      e.target.checked
                        ? [...payTypes, type]
                        : payTypes.filter((value) => value !== type),
                    )
                  }
                />
                {type === "alipay" ? "支付宝" : "微信支付"}
              </label>
            ))}
          </div>
        </SettingRow>
        <SettingRow title="回调站点地址" labelFor="payment-notify">
          <Input
            id="payment-notify"
            disabled={disabled}
            value={notifyBaseUrl}
            onChange={(e) => setNotifyBaseUrl(e.target.value)}
          />
        </SettingRow>
      </SettingSection>
      <div className="flex gap-3">
        <Button disabled={disabled || !dirty} onClick={() => void save()}>
          保存配置
        </Button>
        <Button variant="outline" disabled={busy || !dirty} onClick={reset}>
          撤销修改
        </Button>
      </div>
    </section>
  )
}
