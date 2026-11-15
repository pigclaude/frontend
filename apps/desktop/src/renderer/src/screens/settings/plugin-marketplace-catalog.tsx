// 展示启用市场源的目录和条目详情，安装与更新动作取主进程投影。

import { useId } from "react"
import { Download, Search, Store, TriangleAlert } from "lucide-react"
import { Badge, Button, Dialog, EmptyState, EntityAvatar } from "@pigclaude/ui-primitives"
import type {
  PluginMarketplaceEntryView,
  PluginMarketplaceSourceView,
} from "../../../../plugin-marketplace-contract"
import { fill, useText, type TextKey } from "../../locale/text"
import { marketplaceErrorKey, marketplaceSourceMeta } from "./plugin-marketplace-view"
import { pluginPermissionText } from "./plugin-settings-view"

type EntryAction = (entry: PluginMarketplaceEntryView) => void

function typeLabel(type: PluginMarketplaceEntryView["type"]): TextKey {
  return type === "claude-code" ? "pluginSettings.claudeCode" : "pluginSettings.capability"
}

/** 目录按来源分组，不从显示名称或版本推测安装状态。 */
export function PluginMarketplaceCatalog({
  sources,
  entries,
  query,
  disabled,
  hasDisabledSources,
  onDetails,
  onApply,
  onAdd,
}: {
  sources: readonly PluginMarketplaceSourceView[]
  entries: readonly PluginMarketplaceEntryView[]
  query: string
  disabled: boolean
  hasDisabledSources: boolean
  onDetails: EntryAction
  onApply: EntryAction
  onAdd: () => void
}) {
  const { t } = useText()
  const needle = query.trim().toLowerCase()
  const grouped = new Map<string, PluginMarketplaceEntryView[]>()
  for (const entry of entries) {
    if (
      needle &&
      ![entry.id, entry.name, entry.author, entry.description, t(typeLabel(entry.type))].some(
        (text) => text?.toLowerCase().includes(needle),
      )
    )
      continue
    const group = grouped.get(entry.sourceId)
    if (group) group.push(entry)
    else grouped.set(entry.sourceId, [entry])
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        className="market-empty"
        icon={<Store className="ic" aria-hidden="true" />}
        title={t(
          hasDisabledSources ? "pluginMarketplace.noEnabledSources" : "pluginMarketplace.noSources",
        )}
        actions={
          !hasDisabledSources && !disabled ? (
            <Button type="button" size="sm" onClick={onAdd}>
              {t("pluginMarketplace.addSource")}
            </Button>
          ) : null
        }
      />
    )
  }
  if (needle && grouped.size === 0) {
    return (
      <EmptyState
        className="market-empty"
        icon={<Search className="ic" aria-hidden="true" />}
        title={t("pluginMarketplace.noMatches")}
      />
    )
  }
  return (
    <>
      {sources
        .filter(({ id }) => !needle || grouped.has(id))
        .map((source) => (
          <MarketplaceSection
            key={source.id}
            source={source}
            entries={grouped.get(source.id) ?? []}
            disabled={disabled}
            onDetails={onDetails}
            onApply={onApply}
          />
        ))}
    </>
  )
}

function MarketplaceSection({
  source,
  entries,
  disabled,
  onDetails,
  onApply,
}: {
  source: PluginMarketplaceSourceView
  entries: readonly PluginMarketplaceEntryView[]
  disabled: boolean
  onDetails: EntryAction
  onApply: EntryAction
}) {
  const { t, locale } = useText()
  const headingId = useId()
  return (
    <section className="market-section" aria-labelledby={headingId}>
      <header className="market-section-head">
        <h2 id={headingId} className="market-section-title">
          {source.catalogName}
        </h2>
        <p className="market-section-meta">{marketplaceSourceMeta(source, locale, t)}</p>
        {source.error ? (
          <p className="market-section-error">
            <TriangleAlert className="ic ic-xs" aria-hidden="true" />
            {t(marketplaceErrorKey(source.error, "pluginMarketplace.refreshFailed"))}
          </p>
        ) : null}
      </header>
      {entries.length ? (
        <div className="market-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="market-tile">
              <button
                type="button"
                className="market-tile-main"
                aria-label={fill(t("pluginMarketplace.details"), { plugin: entry.name })}
                onClick={() => onDetails(entry)}
              >
                <EntityAvatar
                  id={source.id + "/" + entry.id}
                  name={entry.name}
                  className="market-icon"
                />
                <span className="market-tile-text">
                  <span className="market-tile-name">
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="market-tile-desc truncate">
                    {t(typeLabel(entry.type))}
                    {entry.version ? ` · ${entry.version}` : ""}
                  </span>
                </span>
              </button>
              <div className="market-tile-actions">
                <MarketplaceApplyButton entry={entry} disabled={disabled} onApply={onApply} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="market-section-empty">{t("pluginMarketplace.noEntries")}</p>
      )}
    </section>
  )
}

/** 目录详情展示来源公布的元数据，真正的安装范围由下一步披露。 */
export function PluginMarketplaceEntryDialog({
  entry,
  source,
  busy,
  disabled,
  error,
  onClose,
  onApply,
}: {
  entry: PluginMarketplaceEntryView
  source: PluginMarketplaceSourceView
  busy: boolean
  disabled: boolean
  error: string | null
  onClose: () => void
  onApply: EntryAction
}) {
  const { t } = useText()
  const none = t("pluginSettings.none")
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Content
        className="plugin-dialog"
        closeLabel={t("pluginSettings.close")}
        closeDisabled={busy}
        title={
          <>
            <EntityAvatar
              id={source.id + "/" + entry.id}
              name={entry.name}
              className="market-icon"
            />
            {entry.name}
          </>
        }
        description={
          <span className="plugin-dialog-meta">
            <Badge>{t(typeLabel(entry.type))}</Badge>
            {entry.version}
          </span>
        }
      >
        <Dialog.Body className="plugin-dialog-body">
          {entry.description ? <p className="agent-description">{entry.description}</p> : null}
          <dl className="ext-facts">
            <dt>{t("pluginMarketplace.marketplace")}</dt>
            <dd>{source.catalogName}</dd>
            {entry.author ? (
              <>
                <dt>{t("pluginMarketplace.author")}</dt>
                <dd>{entry.author}</dd>
              </>
            ) : null}
            <dt>{t("pluginMarketplace.declaredPermissions")}</dt>
            <dd>
              {entry.permissions
                .map((permission) => pluginPermissionText(permission, t))
                .join(", ") || none}
            </dd>
            <dt>{t("pluginMarketplace.declaredDomains")}</dt>
            <dd className="mono">{entry.domains.join(", ") || none}</dd>
          </dl>
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p className="hint" role="status">
              {t("pluginSettings.reviewing")}
            </p>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <MarketplaceApplyButton entry={entry} disabled={disabled} primary onApply={onApply} />
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function MarketplaceApplyButton({
  entry,
  disabled,
  primary,
  onApply,
}: {
  entry: PluginMarketplaceEntryView
  disabled: boolean
  primary?: boolean
  onApply: EntryAction
}) {
  const { t } = useText()
  if (entry.action === "installed")
    return <span className="market-installed">{t("pluginMarketplace.installed")}</span>
  const update = entry.action === "update"
  return (
    <Button
      type="button"
      size="sm"
      variant={primary ? "primary" : "secondary"}
      className={primary ? undefined : "market-pill"}
      disabled={disabled}
      aria-label={fill(
        t(update ? "pluginMarketplace.updateEntry" : "pluginMarketplace.installEntry"),
        { plugin: entry.name },
      )}
      onClick={() => onApply(entry)}
    >
      {update ? null : <Download className="ic ic-sm" aria-hidden="true" />}
      {t(update ? "pluginMarketplace.update" : "pluginMarketplace.install")}
    </Button>
  )
}
