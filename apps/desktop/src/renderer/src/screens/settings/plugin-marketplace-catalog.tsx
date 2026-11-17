// 展示启用市场源的目录和条目详情，安装与更新动作取主进程投影。

import { useId, useState } from "react"
import {
  Download,
  Puzzle,
  RefreshCw,
  Search,
  SquareTerminal,
  Store,
  TriangleAlert,
} from "lucide-react"
import { Badge, Button, Dialog, EmptyState } from "@pigclaude/ui-primitives"
import type {
  PluginMarketplaceEntryView,
  PluginMarketplaceSourceView,
} from "../../../../plugin-marketplace-contract"
import { fill, useText, type TextKey } from "../../locale/text"
import type { MarketplaceBrowse } from "./plugin-marketplace-navigation"
import {
  marketplaceBlockedMessage,
  marketplaceErrorKey,
  marketplaceSourceName,
} from "./plugin-marketplace-view"
import { pluginPermissionText } from "./plugin-settings-view"

type EntryAction = (entry: PluginMarketplaceEntryView) => void
const collapsedCount = 6

function typeLabel(type: PluginMarketplaceEntryView["type"]): TextKey {
  return type === "claude-code" ? "pluginSettings.claudeCode" : "pluginSettings.capability"
}

function MarketplaceEntryIcon({ type }: { type: PluginMarketplaceEntryView["type"] }) {
  const Icon = type === "claude-code" ? SquareTerminal : Puzzle
  return (
    <span className="market-icon marketplace-entry-icon" data-plugin-type={type} aria-hidden="true">
      <Icon className="ic" />
    </span>
  )
}

/** 标注主进程确认的审核状态，市场目录和安装披露使用同样的标识。 */
export function MarketplaceReviewBadge({
  status,
}: {
  status: PluginMarketplaceEntryView["reviewStatus"]
}) {
  const { t } = useText()
  const reviewed = status === "reviewed"
  return (
    <Badge variant={reviewed ? "ok" : "warn"}>
      {t(reviewed ? "pluginMarketplace.reviewed" : "pluginMarketplace.unreviewed")}
    </Badge>
  )
}

/** 公开和社区按签名目录的维护方及用途分组，个人按市场源分组。 */
export function PluginMarketplaceCatalog({
  sources,
  entries,
  browse,
  disabled,
  hasDisabledSources,
  thirdPartyEnabled,
  onDetails,
  onApply,
  onAdd,
  onManageSources,
  onRefresh,
}: {
  sources: readonly PluginMarketplaceSourceView[]
  entries: readonly PluginMarketplaceEntryView[]
  browse: MarketplaceBrowse
  disabled: boolean
  hasDisabledSources: boolean
  thirdPartyEnabled: boolean
  onDetails: EntryAction
  onApply: EntryAction
  onAdd: () => void
  onManageSources: () => void
  onRefresh: (sourceId: string) => void
}) {
  const { t } = useText()
  const personal = browse.scope === "personal"
  const community = browse.scope === "community"
  const scopedSources = sources.filter(({ kind }) => (kind === "official") !== personal)
  const sourceIds = new Set(scopedSources.map(({ id }) => id))
  const needle = browse.query.trim().toLowerCase()
  const grouped = new Map<string, PluginMarketplaceEntryView[]>()
  for (const entry of entries) {
    if (!sourceIds.has(entry.sourceId)) continue
    if (!personal && (entry.officialListing?.publisherType === "community") !== community) continue
    const category = entry.officialListing?.category ?? t(typeLabel(entry.type))
    if (
      needle &&
      ![
        entry.id,
        entry.name,
        entry.author,
        entry.description,
        category,
        t(typeLabel(entry.type)),
      ].some((text) => text?.toLowerCase().includes(needle))
    )
      continue
    const key = personal ? entry.sourceId : category
    const group = grouped.get(key)
    if (group) group.push(entry)
    else grouped.set(key, [entry])
  }

  if (personal && (!thirdPartyEnabled || scopedSources.length === 0)) {
    const canAdd = thirdPartyEnabled && !hasDisabledSources
    const title = !thirdPartyEnabled
      ? "pluginMarketplace.thirdPartyOff"
      : hasDisabledSources
        ? "pluginMarketplace.noEnabledSources"
        : "pluginMarketplace.noSources"
    return (
      <EmptyState
        className="market-empty"
        icon={<Store className="ic" aria-hidden="true" />}
        title={t(title)}
        actions={
          disabled ? null : (
            <Button type="button" size="sm" onClick={canAdd ? onAdd : onManageSources}>
              {t(canAdd ? "pluginMarketplace.addSource" : "pluginMarketplace.manageSources")}
            </Button>
          )
        }
      />
    )
  }
  const sections = personal
    ? scopedSources
        .filter(({ id }) => !needle || grouped.has(id))
        .map((source) => ({ key: source.id, heading: marketplaceSourceName(source, t), source }))
    : [...grouped.keys()].map((heading) => ({ key: heading, heading, source: undefined }))
  return (
    <>
      {personal
        ? null
        : scopedSources.map(({ id, error }) => <MarketplaceSourceIssue key={id} error={error} />)}
      {sections.length ? (
        sections.map(({ key, heading, source }) => (
          <MarketplaceSection
            key={key}
            heading={heading}
            entries={grouped.get(key) ?? []}
            disabled={disabled}
            searching={needle !== ""}
            error={source?.error ?? null}
            onDetails={onDetails}
            onApply={onApply}
            onRefresh={source ? () => onRefresh(source.id) : undefined}
          />
        ))
      ) : (
        <EmptyState
          className="market-empty"
          icon={needle ? <Search className="ic" /> : <Puzzle className="ic" />}
          title={t(
            needle
              ? "pluginMarketplace.noMatches"
              : community
                ? "pluginMarketplace.noCommunity"
                : "pluginMarketplace.noEntries",
          )}
          description={!needle && community ? t("pluginMarketplace.communityEmptyHint") : undefined}
        />
      )}
    </>
  )
}

function MarketplaceSourceIssue({ error }: { error: string | null }) {
  const { t } = useText()
  return error ? (
    <p className="market-section-error">
      <TriangleAlert className="ic ic-xs" aria-hidden="true" />
      {t(marketplaceErrorKey(error, "pluginMarketplace.refreshFailed"))}
    </p>
  ) : null
}

function MarketplaceSection({
  heading,
  entries,
  disabled,
  searching,
  error,
  onDetails,
  onApply,
  onRefresh,
}: {
  heading: string
  entries: readonly PluginMarketplaceEntryView[]
  disabled: boolean
  searching: boolean
  error: string | null
  onDetails: EntryAction
  onApply: EntryAction
  onRefresh: (() => void) | undefined
}) {
  const { t } = useText()
  const headingId = useId()
  const [expanded, setExpanded] = useState(false)
  const collapsible = !searching && entries.length > collapsedCount
  const visibleEntries = collapsible && !expanded ? entries.slice(0, collapsedCount) : entries
  const refreshLabel = fill(t("pluginMarketplace.refreshSource"), { market: heading })
  return (
    <section className="market-section" aria-labelledby={headingId}>
      <header className="market-section-head">
        <div className="market-section-titlebar">
          <h2 id={headingId} className="market-section-title">
            {heading}
          </h2>
          {onRefresh ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled}
              aria-label={refreshLabel}
              title={refreshLabel}
              onClick={onRefresh}
            >
              <RefreshCw className="ic ic-sm" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>
      <MarketplaceSourceIssue error={error} />
      {entries.length ? (
        <div className="market-grid">
          {visibleEntries.map((entry) => (
            <div key={entry.id} className="market-tile">
              <button
                type="button"
                className="market-tile-main"
                aria-label={fill(t("pluginMarketplace.details"), { plugin: entry.name })}
                onClick={() => onDetails(entry)}
              >
                <MarketplaceEntryIcon type={entry.type} />
                <span className="market-tile-text">
                  <span className="market-tile-name">
                    <span className="truncate">{entry.name}</span>
                    <MarketplaceReviewBadge status={entry.reviewStatus} />
                  </span>
                  <span className="market-tile-desc marketplace-entry-summary">
                    {entry.description || t(typeLabel(entry.type))}
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
        <EmptyState
          className="market-empty"
          icon={<Puzzle className="ic" aria-hidden="true" />}
          title={t("pluginMarketplace.noEntries")}
        />
      )}
      {collapsible ? (
        <button
          type="button"
          className="market-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? t("pluginMarketplace.showLess")
            : fill(t("pluginMarketplace.showAll"), { count: entries.length })}
        </button>
      ) : null}
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
            <MarketplaceEntryIcon type={entry.type} />
            {entry.name}
          </>
        }
        description={
          <span className="plugin-dialog-meta">
            <Badge>{t(typeLabel(entry.type))}</Badge>
            <MarketplaceReviewBadge status={entry.reviewStatus} />
            {entry.version}
          </span>
        }
      >
        <Dialog.Body className="plugin-dialog-body">
          {entry.action === "blocked" ? (
            <p className="marketplace-risk">
              <TriangleAlert className="ic ic-sm" aria-hidden="true" />
              <span>{t(marketplaceBlockedMessage(entry.blockedBy).reason)}</span>
            </p>
          ) : null}
          {entry.description ? <p className="agent-description">{entry.description}</p> : null}
          <dl className="ext-facts">
            <dt>{t("pluginMarketplace.marketplace")}</dt>
            <dd>{marketplaceSourceName(source, t)}</dd>
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
        {entry.action !== "blocked" ? (
          <Dialog.Footer>
            <MarketplaceApplyButton entry={entry} disabled={disabled} primary onApply={onApply} />
          </Dialog.Footer>
        ) : null}
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
  if (entry.action === "blocked")
    return (
      <span className="market-installed">
        {t(marketplaceBlockedMessage(entry.blockedBy).title)}
      </span>
    )
  if (entry.action === "installed")
    return <span className="market-installed">{t("pluginMarketplace.installed")}</span>
  const update = entry.action === "update"
  return (
    <Button
      type="button"
      size={primary ? "lg" : "md"}
      variant={primary ? "primary" : "plain"}
      className={primary ? undefined : "market-pill"}
      disabled={disabled}
      aria-label={fill(
        t(update ? "pluginMarketplace.updateEntry" : "pluginMarketplace.installEntry"),
        { plugin: entry.name },
      )}
      onClick={() => onApply(entry)}
    >
      {!update && primary ? <Download className="ic ic-sm" aria-hidden="true" /> : null}
      {t(update ? "pluginMarketplace.update" : "pluginMarketplace.install")}
    </Button>
  )
}
