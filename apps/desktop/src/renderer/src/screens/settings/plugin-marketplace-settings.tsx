// 管理市场缓存、来源对话框和绑定一次安装或更新的确认生命周期。

import { useEffect, useReducer, useRef, useState } from "react"
import { Settings2 } from "lucide-react"
import { Button, SearchField } from "@pigclaude/ui-primitives"
import type {
  CapabilityPluginsBridge,
  DesktopPluginInstallDisclosure,
} from "../../../../capability-plugin-contract"
import type {
  PluginMarketplaceBridge,
  PluginMarketplaceEntryView,
  PluginMarketplaceView,
} from "../../../../plugin-marketplace-contract"
import { useText, type TextKey } from "../../locale/text"
import { PluginInstallDisclosure, type PluginUpdateDisclosure } from "./plugin-install-disclosure"
import { PluginMarketplaceAddSource } from "./plugin-marketplace-add-source"
import {
  PluginMarketplaceCatalog,
  PluginMarketplaceEntryDialog,
} from "./plugin-marketplace-catalog"
import { PluginMarketplaceSourceDialog } from "./plugin-marketplace-source-dialog"
import { marketplaceErrorKey } from "./plugin-marketplace-view"
import { pluginInstallDisclosure } from "./plugin-settings-view"
import "../../styles/plugin-marketplace.css"

type MarketDialog =
  | { kind: "sources" }
  | { kind: "add" }
  | { kind: "details"; sourceId: string; entryId: string }
  | {
      kind: "review"
      sourceId: string
      disclosure: DesktopPluginInstallDisclosure
      update?: PluginUpdateDisclosure
    }

type MarketLifetime = { closed: boolean; busy: boolean; preparedId: string | null }
type Installer = Pick<CapabilityPluginsBridge, "confirm" | "cancel">

function discard(installer: Installer, id: string): void {
  void installer.cancel(id).catch(() => undefined)
}

/** 让用户浏览本机目录、管理来源，并显式安装或更新目录中的插件。 */
export function PluginMarketplaceSettings({
  bridge,
  installer,
  membershipActive,
  onInstalled,
}: {
  bridge: PluginMarketplaceBridge
  installer: Installer
  membershipActive: boolean
  onInstalled: () => void
}) {
  const { t } = useText()
  const [view, setView] = useState<PluginMarketplaceView | null>(null)
  const [readError, setReadError] = useState<TextKey | null>(null)
  const [error, setError] = useState<TextKey | null>(null)
  const [notice, setNotice] = useState<TextKey | null>(null)
  const [revision, refresh] = useReducer((value: number) => value + 1, 0)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<MarketDialog | null>(null)
  const [query, setQuery] = useState("")
  const owner = useRef<MarketLifetime | null>(null)

  useEffect(() => bridge.subscribe(refresh), [bridge])
  useEffect(() => {
    let current = true
    void bridge.list().then(
      (next) => {
        if (!current) return
        setView(next)
        setReadError(null)
      },
      (cause: unknown) => {
        if (current) setReadError(marketplaceErrorKey(cause, "pluginMarketplace.loadFailed"))
      },
    )
    return () => {
      current = false
    }
  }, [bridge, revision, membershipActive])
  useEffect(() => {
    const current: MarketLifetime = { closed: false, busy: false, preparedId: null }
    owner.current = current
    setBusy(false)
    setDialog(null)
    setError(null)
    setNotice(null)
    return () => {
      current.closed = true
      owner.current = null
      if (current.preparedId) discard(installer, current.preparedId)
    }
  }, [bridge, installer, membershipActive])

  const sources = view?.sources ?? []
  const enabled = sources.filter((source) => source.enabled)
  const sourcesById = new Map(enabled.map((source) => [source.id, source]))
  const entries = view?.entries.filter(({ sourceId }) => sourcesById.has(sourceId)) ?? []
  const dialogSource =
    dialog?.kind === "details" || dialog?.kind === "review"
      ? sourcesById.get(dialog.sourceId)
      : undefined
  const selected =
    dialog?.kind === "details"
      ? entries.find(({ sourceId, id }) => sourceId === dialog.sourceId && id === dialog.entryId)
      : undefined
  const disabled = !membershipActive || busy
  const errorText = error ? t(error) : null

  useEffect(() => {
    if (busy || view === null) return
    if (dialog?.kind === "details" && !selected) setDialog(null)
    if (dialog?.kind === "review" && !dialogSource) {
      const current = owner.current
      if (current?.preparedId === dialog.disclosure.confirmationId) {
        current.preparedId = null
        discard(installer, dialog.disclosure.confirmationId)
      }
      setDialog(null)
      setError("pluginMarketplace.sourceDisabled")
    }
  }, [busy, view, dialog, dialogSource, selected, installer])

  async function run(operate: (current: MarketLifetime) => Promise<void>): Promise<void> {
    const current = owner.current
    if (!current || !membershipActive || current.busy) return
    current.busy = true
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      await operate(current)
    } catch (cause: unknown) {
      if (!current.closed) setError(marketplaceErrorKey(cause))
    } finally {
      current.busy = false
      if (!current.closed) {
        setBusy(false)
        refresh()
      }
    }
  }

  function show(next: MarketDialog | null): void {
    setError(null)
    setDialog(next)
  }

  function showReview(
    current: MarketLifetime,
    review: Extract<MarketDialog, { kind: "review" }>,
  ): void {
    const id = review.disclosure.confirmationId
    if (current.closed) {
      discard(installer, id)
      return
    }
    current.preparedId = id
    setDialog(review)
  }

  function apply(entry: PluginMarketplaceEntryView): void {
    const { sourceId, id, action } = entry
    if (action === "installed" || !sourcesById.has(sourceId)) return
    void run(async (current) => {
      if (action === "install") {
        const disclosure = await bridge.prepareInstall(sourceId, id)
        showReview(current, { kind: "review", sourceId, disclosure })
        return
      }
      const result = await bridge.prepareUpdate(sourceId, id)
      if (result.kind === "review") {
        showReview(current, {
          kind: "review",
          sourceId,
          disclosure: result.disclosure,
          update: result,
        })
      } else if (!current.closed) {
        if (result.kind === "updated") onInstalled()
        setNotice(
          result.kind === "updated"
            ? "pluginMarketplace.statusUpdated"
            : "pluginMarketplace.statusUnchanged",
        )
        setDialog(null)
      }
    })
  }

  function cancelReview(): void {
    const current = owner.current
    if (!current || current.busy || !current.preparedId) return
    discard(installer, current.preparedId)
    current.preparedId = null
    setDialog(null)
  }

  function confirmReview(review: Extract<MarketDialog, { kind: "review" }>): void {
    const { confirmationId } = review.disclosure
    if (!sourcesById.has(review.sourceId)) return
    void run(async (current) => {
      if (current.preparedId !== confirmationId) return
      current.preparedId = null
      try {
        await installer.confirm(confirmationId)
        if (!current.closed) {
          onInstalled()
          setNotice(
            review.update ? "pluginMarketplace.statusUpdated" : "pluginMarketplace.statusInstalled",
          )
        }
      } catch (cause: unknown) {
        discard(installer, confirmationId)
        throw cause
      } finally {
        if (!current.closed) setDialog(null)
      }
    })
  }

  return (
    <div className="plugin-market">
      <div className="market-toolbar">
        <SearchField
          className="market-search"
          value={query}
          onValueChange={setQuery}
          placeholder={t("pluginMarketplace.search")}
          clearLabel={t("pluginSettings.clearSearch")}
        />
        <Button
          type="button"
          className="market-sources-btn"
          disabled={view === null || busy}
          onClick={() => show({ kind: "sources" })}
        >
          <Settings2 className="ic ic-sm" aria-hidden="true" />
          {t("pluginMarketplace.sources")}
        </Button>
      </div>
      {!membershipActive && readError !== "pluginMarketplace.membership" ? (
        <p className="hint">{t("pluginMarketplace.membership")}</p>
      ) : null}
      {notice ? (
        <p className="market-notice" role="status">
          {t(notice)}
        </p>
      ) : null}
      {busy && !dialog ? (
        <p className="hint" role="status">
          {t("pluginSettings.reviewing")}
        </p>
      ) : null}
      {readError ? (
        <div className="market-error">
          <p className="error-text" role="alert">
            {t(readError)}
          </p>
          <Button type="button" size="sm" disabled={busy} onClick={refresh}>
            {t("pluginSettings.retry")}
          </Button>
        </div>
      ) : null}
      {errorText && !dialog ? (
        <p className="market-error error-text" role="alert">
          {errorText}
        </p>
      ) : null}
      {view === null && !readError ? (
        <p className="hint" role="status">
          {t("pluginMarketplace.loading")}
        </p>
      ) : null}
      {view ? (
        <PluginMarketplaceCatalog
          sources={enabled}
          entries={entries}
          query={query}
          disabled={disabled}
          hasDisabledSources={sources.length > 0 && enabled.length === 0}
          onDetails={(entry) =>
            show({ kind: "details", sourceId: entry.sourceId, entryId: entry.id })
          }
          onApply={apply}
          onAdd={() => show({ kind: "add" })}
        />
      ) : null}
      {dialog?.kind === "sources" ? (
        <PluginMarketplaceSourceDialog
          sources={sources}
          busy={busy}
          membershipActive={membershipActive}
          error={errorText}
          onClose={() => show(null)}
          onAdd={() => show({ kind: "add" })}
          onRefresh={(id) => void run(() => bridge.refresh(id))}
          onSetEnabled={(id, enabled) => void run(() => bridge.setEnabled(id, enabled))}
          onRemove={(id) => void run(() => bridge.remove(id))}
        />
      ) : null}
      {dialog?.kind === "add" && view && membershipActive ? (
        <PluginMarketplaceAddSource
          developerMode={view.developerMode}
          busy={busy}
          error={errorText}
          selectDirectory={bridge.selectDirectory}
          onClose={() => show({ kind: "sources" })}
          onAdd={(input) =>
            void run(async (current) => {
              await bridge.add(input)
              if (!current.closed) show({ kind: "sources" })
            })
          }
        />
      ) : null}
      {dialog?.kind === "details" && selected && dialogSource ? (
        <PluginMarketplaceEntryDialog
          entry={selected}
          source={dialogSource}
          busy={busy}
          disabled={disabled}
          error={errorText}
          onClose={() => show(null)}
          onApply={apply}
        />
      ) : null}
      {dialog?.kind === "review" && dialogSource && membershipActive ? (
        <PluginInstallDisclosure
          facts={pluginInstallDisclosure(dialog.disclosure, t)}
          sourceName={dialogSource.catalogName}
          update={dialog.update}
          busy={busy}
          onCancel={cancelReview}
          onConfirm={() => confirmReview(dialog)}
        />
      ) : null}
    </div>
  )
}
