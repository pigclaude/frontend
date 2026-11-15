// 更换固定提交或归档校验值时保留原市场身份和启停状态。

import { useId, useState, type FormEvent } from "react"
import { Button, Dialog, Input } from "@pigclaude/ui-primitives"
import type { PluginMarketplaceSourceView } from "../../../../plugin-marketplace-contract"
import { useText } from "../../locale/text"
import { marketplaceSourcePin } from "./plugin-marketplace-view"

/** 用跟当前来源类型对应的新 pin 触发一次刷新。 */
export function PluginMarketplacePinDialog({
  source,
  busy,
  error,
  onClose,
  onApply,
}: {
  source: PluginMarketplaceSourceView
  busy: boolean
  error: string | null
  onClose: () => void
  onApply: (pin: string) => void
}) {
  const { t } = useText()
  const fieldId = useId()
  const [value, setValue] = useState(source.pin ?? "")
  const { kind } = source
  if (kind === "directory") return null
  const isGitHub = kind === "github"
  const pin = marketplaceSourcePin(kind, value)
  const canApply = pin !== null && pin !== source.pin && !busy

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (canApply) onApply(pin)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Content
        className="marketplace-dialog"
        title={t("pluginMarketplace.pinTitle")}
        description={source.catalogName}
        closeLabel={t("pluginSettings.close")}
        closeDisabled={busy}
      >
        <form onSubmit={submit}>
          <Dialog.Body>
            <div className="field">
              <label className="label" htmlFor={fieldId}>
                {t(isGitHub ? "pluginMarketplace.commit" : "pluginMarketplace.sha256")}
              </label>
              <Input
                id={fieldId}
                value={value}
                className="mono"
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                maxLength={isGitHub ? 40 : 64}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
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
            <Button type="submit" variant="primary" disabled={!canApply}>
              {t(busy ? "pluginMarketplace.pinApplying" : "pluginMarketplace.pinApply")}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
