// 负责主应用的插件市场与安装管理，复用 Pigcode 的列表和详情。

import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, Box, Check, RefreshCw } from "lucide-react"
import { Button, Checkbox, Dialog, EmptyState, SearchField } from "@pigclaude/ui-primitives"
import { PluginDetailsDialog, PluginList } from "@pigclaude/ui-plugin-manager"
import { PageErrorBoundary, ScrollPanel } from "@pigclaude/ui-shell"
import type {
  CapabilityPluginsBridge,
  InstalledDesktopPlugin,
} from "../../../capability-plugin-contract"
import { fill, useText, type TextKey } from "../locale/text"
import { CapabilityPluginSettingsForm } from "./settings/capability-plugin-settings-form"
import { ClaudeCodePluginFacts } from "./settings/claude-code-plugin-facts"
import { PluginInstallControls } from "./settings/plugin-install-controls"
import type { MarketplaceBrowse } from "./settings/plugin-marketplace-navigation"
import { PluginMarketplaceSettings } from "./settings/plugin-marketplace-settings"
import {
  installedPluginSummary,
  pluginRevocationReason,
  pluginSettingsError,
} from "./settings/plugin-settings-view"
import "../styles/plugin-settings.css"

type PluginData = { developerMode: boolean; installed: InstalledDesktopPlugin[] }
type Details = { id: string; confirmUninstall: boolean; keepData: boolean }
/** 市场和管理使用独立导航位置，来回切换时保留目录分段与搜索词。 */
export function PluginsScreen({
  management,
  membershipActive,
  onOpenManagement,
  onOpenMarketplace,
}: {
  management: boolean
  membershipActive: boolean
  onOpenManagement: () => void
  onOpenMarketplace: () => void
}) {
  const { t } = useText()
  const bridge = window.pigclaude?.capabilityPlugins
  const marketplace = window.pigclaude?.pluginMarketplace
  const [browse, setBrowse] = useState<MarketplaceBrowse>({ scope: "public", query: "" })
  return (
    <PageErrorBoundary
      key={management ? "management" : "marketplace"}
      fallback={(reason) => (
        <EmptyState title={t("pluginSettings.loadFailed")} description={reason} />
      )}
    >
      <ScrollPanel>
        <section className="page wide plugins-screen" aria-labelledby="plugins-heading">
          {!management && bridge && marketplace ? (
            <PluginMarketplaceSettings
              bridge={marketplace}
              installer={bridge}
              membershipActive={membershipActive}
              browse={browse}
              onBrowseChange={setBrowse}
              onOpenManagement={onOpenManagement}
            />
          ) : (
            <PluginManagement
              bridge={bridge}
              membershipActive={membershipActive}
              onOpenMarketplace={management && marketplace ? onOpenMarketplace : undefined}
            />
          )}
        </section>
      </ScrollPanel>
    </PageErrorBoundary>
  )
}

function PluginManagement({
  bridge,
  membershipActive,
  onOpenMarketplace,
}: {
  bridge: CapabilityPluginsBridge | undefined
  membershipActive: boolean
  onOpenMarketplace: (() => void) | undefined
}) {
  const { t } = useText()
  const [data, setData] = useState<PluginData | null>(null)
  const [revision, refresh] = useReducer((value: number) => value + 1, 0)
  const [loadError, setLoadError] = useState<TextKey | null>(null)
  const [operationError, setOperationError] = useState<TextKey | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [details, setDetails] = useState<Details | null>(null)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const pending = useRef(false)

  useEffect(() => bridge?.subscribe(refresh), [bridge])
  useEffect(() => {
    if (!bridge) return
    let current = true
    void Promise.all([bridge.status(), bridge.list()]).then(
      ([status, installed]) => {
        if (!current) return
        setData({ ...status, installed })
        setLoadError(null)
      },
      (cause: unknown) => {
        if (current) setLoadError(pluginSettingsError(cause, "pluginSettings.loadFailed"))
      },
    )
    return () => {
      current = false
    }
  }, [bridge, revision])

  async function modify(
    id: string,
    action: (service: CapabilityPluginsBridge) => Promise<unknown>,
  ) {
    if (!bridge || pending.current) return
    pending.current = true
    setPendingId(id)
    setOperationError(null)
    try {
      await action(bridge)
    } catch (cause: unknown) {
      setOperationError(pluginSettingsError(cause))
    } finally {
      refresh()
      pending.current = false
      setPendingId(null)
    }
  }

  const entries = new Map(data?.installed.map((plugin) => [plugin.manifest.id, plugin]))
  const settings = new Map<string, ReactNode>()
  const plugins = [...entries.values()].map((plugin) => {
    const content = plugin.type === "capability" &&
      membershipActive &&
      plugin.enabled &&
      pluginRevocationReason(plugin) === null &&
      plugin.compatible &&
      plugin.manifest.settings.length > 0 && <CapabilityPluginSettingsForm plugin={plugin} />
    if (content) settings.set(plugin.manifest.id, content)
    return installedPluginSummary(plugin, t, Boolean(content))
  })
  const selected = details ? plugins.find((plugin) => plugin.id === details.id) : undefined
  const selectedEntry = details ? entries.get(details.id) : undefined
  const claudeCode = selectedEntry?.type === "claude-code" ? selectedEntry.manifest : null
  const claudeCodeLabel = t("pluginSettings.claudeCode")
  const settingsEntry = settingsId ? entries.get(settingsId) : undefined
  const settingsContent = settingsId ? settings.get(settingsId) : null
  const hasOpenSettings = Boolean(settingsContent)

  useEffect(() => {
    if (settingsId && !hasOpenSettings) setSettingsId(null)
  }, [settingsId, hasOpenSettings])

  function canToggle(id: string): boolean {
    const plugin = entries.get(id)
    return (
      pendingId === null &&
      Boolean(
        bridge &&
        plugin &&
        (plugin.enabled ||
          (membershipActive && plugin.compatible && pluginRevocationReason(plugin) === null)),
      )
    )
  }

  function toggle(id: string, enabled: boolean): void {
    if (canToggle(id)) void modify(id, (service) => service.setEnabled(id, enabled))
  }

  return (
    <div className="plugin-management">
      <header className="page-head plugins-header">
        <div className="plugins-title">
          {onOpenMarketplace ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("pluginSettings.backToMarketplace")}
              title={t("pluginSettings.backToMarketplace")}
              onClick={onOpenMarketplace}
            >
              <ArrowLeft className="ic" aria-hidden="true" />
            </Button>
          ) : null}
          <h1 id="plugins-heading">{t("pluginSettings.manage")}</h1>
        </div>
        <div className="actions plugins-header-actions">
          {bridge ? (
            <Button
              type="button"
              size="icon"
              aria-label={t("pluginSettings.refresh")}
              title={t("pluginSettings.refresh")}
              disabled={pendingId !== null}
              onClick={refresh}
            >
              <RefreshCw className="ic ic-sm" aria-hidden="true" />
            </Button>
          ) : null}
          {bridge && data && membershipActive && !loadError ? (
            <PluginInstallControls
              bridge={bridge}
              developerMode={data.developerMode}
              onError={setOperationError}
              onInstalled={refresh}
            />
          ) : null}
        </div>
      </header>
      {!membershipActive && data ? <p className="hint">{t("pluginSettings.membership")}</p> : null}
      {operationError ? (
        <p role="alert" className="error-text">
          {t(operationError)}
        </p>
      ) : null}
      {!bridge || loadError ? (
        <div>
          <p role="alert" className="error-text">
            {t(loadError ?? "pluginSettings.unavailable")}
          </p>
          {bridge ? (
            <Button type="button" size="sm" onClick={refresh}>
              {t("pluginSettings.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {bridge && !data && !loadError ? (
        <p role="status" className="hint">
          {t("pluginSettings.loading")}
        </p>
      ) : null}
      {data ? (
        <div className="plugin-market">
          {plugins.length ? (
            <>
              <div className="market-toolbar plugins-toolbar">
                <p className="plugin-installed-count">
                  {t("pluginMarketplace.installed")} <span>{plugins.length}</span>
                </p>
                <SearchField
                  className="market-search control-xl"
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t("pluginSettings.search")}
                  clearLabel={t("pluginSettings.clearSearch")}
                />
              </div>
              <PluginList
                plugins={plugins}
                kindLabels={{ agent: claudeCodeLabel }}
                query={query}
                pendingId={pendingId}
                canToggle={canToggle}
                canUninstall={Boolean(bridge)}
                onEnable={(id) => toggle(id, true)}
                onDisable={(id) => toggle(id, false)}
                onDetails={(id, confirmUninstall = false) =>
                  setDetails({ id, confirmUninstall, keepData: false })
                }
                onOpenSettings={setSettingsId}
              />
              <p className="hint plugin-management-note">{t("pluginSettings.description")}</p>
            </>
          ) : (
            <EmptyState
              className="market-empty"
              icon={<Box className="ic" aria-hidden="true" />}
              title={t("pluginSettings.empty")}
              actions={
                onOpenMarketplace ? (
                  <Button type="button" size="sm" onClick={onOpenMarketplace}>
                    {t("pluginSettings.browseMarketplace")}
                  </Button>
                ) : null
              }
            />
          )}
        </div>
      ) : null}
      {details && selected ? (
        <PluginDetailsDialog
          key={selected.id}
          plugin={selected}
          plugins={plugins}
          kindLabel={claudeCode ? claudeCodeLabel : undefined}
          runtimeFacts={claudeCode ? <ClaudeCodePluginFacts manifest={claudeCode} /> : undefined}
          pending={pendingId !== null}
          confirmUninstall={details.confirmUninstall}
          uninstallOptions={
            claudeCode ? (
              <p className="hint">{t("pluginSettings.uninstallClaudeHint")}</p>
            ) : (
              <KeepDataOption
                checked={details.keepData}
                onChange={(keepData) => setDetails({ ...details, keepData })}
              />
            )
          }
          onClose={() => setDetails(null)}
          onUninstall={(id) =>
            void modify(id, (service) => service.uninstall(id, !claudeCode && details.keepData))
          }
        />
      ) : null}
      {settingsEntry && settingsContent ? (
        <Dialog.Root open onOpenChange={(open) => !open && setSettingsId(null)}>
          <Dialog.Content
            className="plugin-settings-dialog"
            title={fill(t("pluginSettings.settings"), { plugin: settingsEntry.manifest.name })}
            closeLabel={t("pluginSettings.close")}
          >
            <Dialog.Body className="plugin-dialog-body">{settingsContent}</Dialog.Body>
          </Dialog.Content>
        </Dialog.Root>
      ) : null}
    </div>
  )
}

function KeepDataOption({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}) {
  const { t } = useText()
  const id = useId()
  return (
    <div className="plugin-uninstall-options">
      <p className="hint">{t("pluginSettings.uninstallHint")}</p>
      <label htmlFor={id}>
        <Checkbox.Root
          id={id}
          checked={checked}
          onCheckedChange={(value) => onChange(value === true)}
        >
          <Checkbox.Indicator>
            <Check className="ic ic-xs" aria-hidden="true" />
          </Checkbox.Indicator>
        </Checkbox.Root>
        {t("pluginSettings.keepData")}
      </label>
    </div>
  )
}
