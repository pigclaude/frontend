// 在市场页显示主进程保存的授权，并在开启前让用户确认风险。

import { ShieldAlert } from "lucide-react"
import { Button, Dialog, Switch } from "@pigclaude/ui-primitives"
import { useText } from "../../locale/text"
import { SettingRow } from "./setting-page"

/** 开关取主进程状态；开启和关闭均由调用方处理。 */
export function PluginMarketplaceThirdPartySwitch({
  enabled,
  disabled,
  error,
  onChange,
}: {
  enabled: boolean
  disabled: boolean
  error: string | null
  onChange: (enabled: boolean) => void
}) {
  const { t } = useText()
  const label = t("pluginMarketplace.thirdParty")
  return (
    <div className="marketplace-policy group">
      <SettingRow title={label} description={t("pluginMarketplace.thirdPartyDescription")}>
        <Switch
          aria-label={label}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </SettingRow>
      {error ? (
        <p className="marketplace-policy-error error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** 资料披露和确认按钮只发出当前这一次开启请求。 */
export function PluginMarketplaceThirdPartyConsent({
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useText()
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onCancel()}>
      <Dialog.Content
        className="marketplace-dialog"
        title={t("pluginMarketplace.thirdPartyConsentTitle")}
        closeLabel={t("pluginSettings.close")}
        closeDisabled={busy}
      >
        <Dialog.Body>
          <p className="marketplace-risk">
            <ShieldAlert className="ic ic-sm" aria-hidden="true" />
            <span>{t("pluginMarketplace.thirdPartyRisk")}</span>
          </p>
          <p className="hint">{t("pluginMarketplace.thirdPartyRuntimeRisk")}</p>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" variant="ghost" disabled={busy} />}>
            {t("pluginSettings.cancel")}
          </Dialog.Close>
          <Button type="button" variant="primary" disabled={busy} onClick={onConfirm}>
            {t("pluginMarketplace.thirdPartyEnable")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
