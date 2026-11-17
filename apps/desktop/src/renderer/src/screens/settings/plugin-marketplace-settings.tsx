// 管理市场缓存、来源对话框和绑定一次安装或更新的确认生命周期。

import { useEffect, useReducer, useRef, useState } from "react"
import { Button } from "@pigclaude/ui-primitives"
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
import {
  PluginMarketplaceBrowseBar,
  PluginMarketplaceHeader,
  type MarketplaceBrowse,
} from "./plugin-marketplace-navigation"
import { PluginMarketplacePinDialog } from "./plugin-marketplace-pin-dialog"
import { PluginMarketplaceSourceDialog } from "./plugin-marketplace-source-dialog"
import { PluginMarketplaceThirdPartyConsent } from "./plugin-marketplace-third-party"
import {
  marketplaceBlockedMessage,
  marketplaceErrorKey,
  marketplaceSourceName,
} from "./plugin-marketplace-view"
import { pluginInstallDisclosure } from "./plugin-settings-view"
import "../../styles/plugin-marketplace.css"

type MarketDialog =
  | { kind: "sources" }
  | { kind: "third-party-consent"; next: "sources" | "add" }
  | { kind: "add" }
  | { kind: "pin"; sourceId: string }
  | { kind: "details"; sourceId: string; entryId: string }
  | {
      kind: "review"
      sourceId: string
      entryId: string
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
  browse,
  onBrowseChange,
  onOpenManagement,
}: {
  bridge: PluginMarketplaceBridge
  installer: Installer
  membershipActive: boolean
  browse: MarketplaceBrowse
  onBrowseChange: (browse: MarketplaceBrowse) => void
  onOpenManagement: () => void
}) {
  const { t } = useText()
  const [view, setView] = useState<PluginMarketplaceView | null>(null)
  const [readError, setReadError] = useState<TextKey | null>(null)
  const [error, setError] = useState<TextKey | null>(null)
  const [notice, setNotice] = useState<TextKey | null>(null)
  const [revision, refresh] = useReducer((value: number) => value + 1, 0)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<MarketDialog | null>(null)
  const owner = useRef<MarketLifetime | null>(null)
  const reads = useRef(0)

  useEffect(() => bridge.subscribe(refresh), [bridge])
  useEffect(() => {
    const read = ++reads.current
    void bridge.list().then(
      (next) => {
        if (read !== reads.current) return
        setView(next)
        setReadError(null)
      },
      (cause: unknown) => {
        if (read === reads.current)
          setReadError(marketplaceErrorKey(cause, "pluginMarketplace.loadFailed"))
      },
    )
    return () => {
      reads.current += 1
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
  const thirdPartyEnabled = view?.thirdPartyEnabled === true
  const thirdPartyIssue = view?.thirdPartyError
    ? t(marketplaceErrorKey(view.thirdPartyError, "pluginMarketplace.thirdPartyCacheInvalid"))
    : null
  const enabled = sources.filter((source) => source.enabled || source.kind === "official")
  const sourcesById = new Map(enabled.map((source) => [source.id, source]))
  const pinSource =
    dialog?.kind === "pin"
      ? sources.find(
          ({ id, kind }) => id === dialog.sourceId && (kind === "github" || kind === "https"),
        )
      : undefined
  const entries =
    view?.entries.filter(
      ({ sourceId }) =>
        sourcesById.has(sourceId) &&
        (thirdPartyEnabled || sourcesById.get(sourceId)?.kind === "official"),
    ) ?? []
  const catalogSources = enabled.filter(({ kind }) => kind === "official" || thirdPartyEnabled)
  const hasDisabledSources = sources.some(({ kind, enabled }) => kind !== "official" && !enabled)
  const entryDialog = dialog?.kind === "details" || dialog?.kind === "review" ? dialog : null
  const dialogSource = entryDialog ? sourcesById.get(entryDialog.sourceId) : undefined
  const selected = entryDialog
    ? entries.find(
        ({ sourceId, id }) => sourceId === entryDialog.sourceId && id === entryDialog.entryId,
      )
    : undefined
  const reviewAllowed = selected?.action === "install" || selected?.action === "update"
  const disabled = !membershipActive || busy
  const errorText = error ? t(error) : null

  useEffect(() => {
    if (busy || view === null) return
    if (dialog?.kind === "pin" && !pinSource) setDialog({ kind: "sources" })
    if (!thirdPartyEnabled && (dialog?.kind === "add" || dialog?.kind === "pin"))
      setDialog({ kind: "sources" })
    if (dialog?.kind === "details" && !selected) setDialog(null)
    if (dialog?.kind === "review" && (!dialogSource || !reviewAllowed)) {
      const current = owner.current
      if (current?.preparedId === dialog.disclosure.confirmationId) {
        current.preparedId = null
        discard(installer, dialog.disclosure.confirmationId)
      }
      setDialog(null)
      if (selected?.action === "blocked")
        setError(marketplaceBlockedMessage(selected.blockedBy).reason)
      else if (!dialogSource) setError("pluginMarketplace.sourceDisabled")
      else if (!thirdPartyEnabled && dialogSource.kind !== "official")
        setError("pluginMarketplace.thirdPartyOff")
      else setError("pluginMarketplace.entryUnavailable")
    }
  }, [
    busy,
    view,
    dialog,
    dialogSource,
    selected,
    pinSource,
    installer,
    reviewAllowed,
    thirdPartyEnabled,
  ])

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

  function saveThirdParty(enabled: boolean, next: "sources" | "add" = "sources"): void {
    void run(async (current) => {
      await bridge.setThirdPartyEnabled(enabled)
      if (current.closed) return
      reads.current += 1
      setView((snapshot) => snapshot && { ...snapshot, thirdPartyEnabled: enabled })
      setDialog({ kind: next })
    })
  }

  function openAdd(): void {
    if (!disabled)
      show(thirdPartyEnabled ? { kind: "add" } : { kind: "third-party-consent", next: "add" })
  }

  function refreshSource(id: string): void {
    if (thirdPartyEnabled || sourcesById.get(id)?.kind === "official")
      void run(() => bridge.refresh(id))
  }

  function refreshMarkets(): void {
    void run(async () => {
      const results = await Promise.allSettled(catalogSources.map(({ id }) => bridge.refresh(id)))
      const failed = results.find(({ status }) => status === "rejected")
      if (failed?.status === "rejected") throw failed.reason
    })
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
    const source = sourcesById.get(sourceId)
    if (
      (action !== "install" && action !== "update") ||
      !source ||
      (!thirdPartyEnabled && source.kind !== "official")
    )
      return
    void run(async (current) => {
      if (action === "install") {
        const disclosure = await bridge.prepareInstall(sourceId, id)
        showReview(current, { kind: "review", sourceId, entryId: id, disclosure })
        return
      }
      const result = await bridge.prepareUpdate(sourceId, id)
      if (result.kind === "review") {
        showReview(current, {
          kind: "review",
          sourceId,
          entryId: id,
          disclosure: result.disclosure,
          update: result,
        })
      } else if (!current.closed) {
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
    if (!dialogSource || !reviewAllowed) return
    void run(async (current) => {
      if (current.preparedId !== confirmationId) return
      current.preparedId = null
      try {
        await installer.confirm(confirmationId)
        if (!current.closed) {
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
    <>
      <PluginMarketplaceHeader
        canRefresh={!disabled && catalogSources.length > 0}
        canOpenSources={view !== null && !busy}
        canAdd={view !== null && !disabled}
        onRefresh={refreshMarkets}
        onOpenSources={() => show({ kind: "sources" })}
        onAdd={openAdd}
        onOpenManagement={onOpenManagement}
      />
      <div className="plugin-market marketplace-catalog">
        <PluginMarketplaceBrowseBar browse={browse} disabled={busy} onChange={onBrowseChange} />
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
        {thirdPartyIssue && browse.scope === "personal" ? (
          <p className="market-error error-text" role="alert">
            {thirdPartyIssue}
          </p>
        ) : null}
        {view === null && !readError ? (
          <p className="hint" role="status">
            {t("pluginMarketplace.loading")}
          </p>
        ) : null}
        {view ? (
          <PluginMarketplaceCatalog
            sources={catalogSources}
            entries={entries}
            browse={browse}
            disabled={disabled}
            hasDisabledSources={hasDisabledSources}
            thirdPartyEnabled={thirdPartyEnabled}
            onDetails={(entry) =>
              show({ kind: "details", sourceId: entry.sourceId, entryId: entry.id })
            }
            onApply={apply}
            onAdd={openAdd}
            onManageSources={() => show({ kind: "sources" })}
            onRefresh={refreshSource}
          />
        ) : null}
        {dialog?.kind === "sources" ? (
          <PluginMarketplaceSourceDialog
            sources={sources}
            busy={busy}
            membershipActive={membershipActive}
            thirdPartyEnabled={thirdPartyEnabled}
            error={errorText}
            thirdPartyError={thirdPartyIssue}
            onClose={() => show(null)}
            onAdd={openAdd}
            onThirdPartyChange={(enabled) =>
              enabled
                ? show({ kind: "third-party-consent", next: "sources" })
                : saveThirdParty(false)
            }
            onRefresh={refreshSource}
            onChangePin={(sourceId) => {
              if (thirdPartyEnabled) show({ kind: "pin", sourceId })
            }}
            onSetEnabled={(id, enabled) => void run(() => bridge.setEnabled(id, enabled))}
            onRemove={(id) => void run(() => bridge.remove(id))}
          />
        ) : null}
        {dialog?.kind === "third-party-consent" && membershipActive ? (
          <PluginMarketplaceThirdPartyConsent
            busy={busy}
            error={errorText}
            onCancel={() => show(dialog.next === "sources" ? { kind: "sources" } : null)}
            onConfirm={() => saveThirdParty(true, dialog.next)}
          />
        ) : null}
        {pinSource && membershipActive && thirdPartyEnabled ? (
          <PluginMarketplacePinDialog
            key={pinSource.id}
            source={pinSource}
            busy={busy}
            error={errorText}
            onClose={() => show({ kind: "sources" })}
            onApply={(pin) =>
              void run(async (current) => {
                await bridge.refresh(pinSource.id, pin)
                if (!current.closed) show({ kind: "sources" })
              })
            }
          />
        ) : null}
        {dialog?.kind === "add" && view && membershipActive && thirdPartyEnabled ? (
          <PluginMarketplaceAddSource
            developerMode={view.developerMode}
            busy={busy}
            error={errorText}
            sources={sources}
            selectDirectory={bridge.selectDirectory}
            onClose={() => show({ kind: "sources" })}
            onAdd={(input) =>
              void run(async (current) => {
                await bridge.add(input)
                if (!current.closed) {
                  onBrowseChange({ scope: "personal", query: "" })
                  show({ kind: "sources" })
                }
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
        {dialog?.kind === "review" &&
        dialogSource &&
        selected &&
        membershipActive &&
        reviewAllowed ? (
          <PluginInstallDisclosure
            facts={pluginInstallDisclosure(dialog.disclosure, t)}
            sourceName={marketplaceSourceName(dialogSource, t)}
            reviewStatus={selected.reviewStatus}
            update={dialog.update}
            busy={busy}
            onCancel={cancelReview}
            onConfirm={() => confirmReview(dialog)}
          />
        ) : null}
      </div>
    </>
  )
}
