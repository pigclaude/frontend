// 显示市场源的缓存状态、启停、刷新和删除确认。

import { useState } from "react"
import { Folder, GitBranch, Link2, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react"
import { Button, Dialog, Switch } from "@pigclaude/ui-primitives"
import type { PluginMarketplaceSourceView } from "../../../../plugin-marketplace-contract"
import { fill, useText } from "../../locale/text"
import {
  marketplaceErrorKey,
  marketplaceSourceLabels,
  marketplaceSourceMeta,
} from "./plugin-marketplace-view"

const sourceIcons = { github: GitBranch, https: Link2, directory: Folder }

/** 市场管理对话框保留停用的来源，经过用户确认才删除。 */
export function PluginMarketplaceSourceDialog({
  sources,
  busy,
  membershipActive,
  error,
  onClose,
  onAdd,
  onRefresh,
  onChangePin,
  onSetEnabled,
  onRemove,
}: {
  sources: readonly PluginMarketplaceSourceView[]
  busy: boolean
  membershipActive: boolean
  error: string | null
  onClose: () => void
  onAdd: () => void
  onRefresh: (sourceId: string) => void
  onChangePin: (sourceId: string) => void
  onSetEnabled: (sourceId: string, enabled: boolean) => void
  onRemove: (sourceId: string) => void
}) {
  const { locale, t } = useText()
  const [confirming, setConfirming] = useState<string | null>(null)
  const disabled = busy || !membershipActive
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Content
        className="marketplace-sources"
        title={t("pluginMarketplace.sources")}
        closeLabel={t("pluginSettings.close")}
        closeDisabled={busy}
      >
        <Dialog.Body>
          <div className="marketplace-sources-bar">
            <Button type="button" size="sm" disabled={disabled} onClick={onAdd}>
              <Plus className="ic ic-sm" aria-hidden="true" />
              {t("pluginMarketplace.addSource")}
            </Button>
          </div>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          {sources.length === 0 ? (
            <p className="marketplace-sources-empty">{t("pluginMarketplace.noSources")}</p>
          ) : (
            <ul className="marketplace-source-list">
              {sources.map((source) => {
                const { id, kind, enabled, label, catalogName } = source
                const Icon = sourceIcons[kind]
                const values = { market: catalogName }
                return (
                  <li
                    key={id}
                    className="marketplace-source"
                    data-enabled={enabled ? undefined : "false"}
                  >
                    <span className="marketplace-source-icon" aria-hidden="true">
                      <Icon className="ic ic-sm" />
                    </span>
                    <div className="marketplace-source-text">
                      <span className="marketplace-source-name">
                        <span className="truncate">{catalogName}</span>
                        <span className="marketplace-source-type">
                          {t(marketplaceSourceLabels[kind])}
                        </span>
                        {enabled ? null : (
                          <span className="marketplace-source-type is-off">
                            {t("pluginMarketplace.disabled")}
                          </span>
                        )}
                      </span>
                      <span className="marketplace-source-label mono truncate" title={label}>
                        {label}
                      </span>
                      <span className="marketplace-source-meta">
                        {marketplaceSourceMeta(source, locale, t)}
                      </span>
                      {source.error ? (
                        <span className="marketplace-source-error">
                          <TriangleAlert className="ic ic-xs" aria-hidden="true" />
                          {t(marketplaceErrorKey(source.error, "pluginMarketplace.refreshFailed"))}
                        </span>
                      ) : null}
                      {confirming === id ? (
                        <span className="marketplace-source-confirm">
                          <span>{fill(t("pluginMarketplace.removePrompt"), values)}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirming(null)}
                          >
                            {t("pluginSettings.cancel")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="solidDanger"
                            disabled={disabled}
                            onClick={() => {
                              setConfirming(null)
                              onRemove(id)
                            }}
                          >
                            {t("pluginMarketplace.removeConfirm")}
                          </Button>
                        </span>
                      ) : null}
                    </div>
                    <div className="marketplace-source-actions">
                      <Switch
                        aria-label={fill(t("pluginMarketplace.enableSource"), values)}
                        checked={enabled}
                        disabled={disabled}
                        onCheckedChange={(checked) => onSetEnabled(id, checked)}
                      />
                      {kind !== "directory" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={disabled}
                          aria-label={fill(t("pluginMarketplace.changeSourcePin"), values)}
                          onClick={() => onChangePin(id)}
                        >
                          {t("pluginMarketplace.changePin")}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={fill(t("pluginMarketplace.refreshSource"), values)}
                        onClick={() => onRefresh(id)}
                      >
                        <RefreshCw className="ic ic-sm" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={disabled}
                        aria-label={fill(t("pluginMarketplace.removeSource"), values)}
                        onClick={() => setConfirming(id)}
                      >
                        <Trash2 className="ic ic-sm" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close render={<Button type="button" disabled={busy} />}>
            {t("pluginSettings.close")}
          </Dialog.Close>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
