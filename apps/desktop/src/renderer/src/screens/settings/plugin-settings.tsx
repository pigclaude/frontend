// 连接设置页、已安装的插件和可信安装桥，复用 Pigcode 的列表和详情。

import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from "react"
import { Box, Check } from "lucide-react"
import {
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  SearchField,
  SegmentedControl,
} from "@pigclaude/ui-primitives"
import { PluginDetailsDialog, PluginList } from "@pigclaude/ui-plugin-manager"
import type {
  CapabilityPluginsBridge,
  InstalledCapabilityPlugin,
  InstalledDesktopPlugin,
} from "../../../../capability-plugin-contract"
import type { PluginMarketplaceBridge } from "../../../../plugin-marketplace-contract"
import { fill, useText, type TextKey } from "../../locale/text"
import { ClaudeCodePluginFacts } from "./claude-code-plugin-facts"
import { PluginInstallControls } from "./plugin-install-controls"
import { PluginMarketplaceSettings } from "./plugin-marketplace-settings"
import { installedPluginSummary, pluginSettingsError } from "./plugin-settings-view"
import { SettingPage } from "./setting-page"
import "../../styles/plugin-settings.css"

type PluginData = { developerMode: boolean; installed: InstalledDesktopPlugin[] }
type Details = { id: string; confirmUninstall: boolean; keepData: boolean }
type PluginPage = "installed" | "marketplace"

/** 已安装的插件及管理动作；设置插槽只挂载宿主提供的声明式内容。 */
export function PluginSettings({
  bridge,
  marketplace,
  membershipActive,
  renderSettings,
}: {
  bridge: CapabilityPluginsBridge | undefined
  marketplace?: PluginMarketplaceBridge | undefined
  membershipActive: boolean
  renderSettings?: (plugin: InstalledCapabilityPlugin) => ReactNode
}) {
  const { t } = useText()
  const [page, setPage] = useState<PluginPage>("installed")
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
    const content =
      plugin.type === "capability" &&
      membershipActive &&
      plugin.enabled &&
      plugin.compatible &&
      renderSettings?.(plugin)
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
      Boolean(bridge && plugin && (plugin.enabled || (membershipActive && plugin.compatible)))
    )
  }

  function toggle(id: string, enabled: boolean): void {
    if (canToggle(id)) void modify(id, (service) => service.setEnabled(id, enabled))
  }

  const title = t("pluginSettings.title")
  const navigation =
    bridge && marketplace ? (
      <SegmentedControl<PluginPage>
        className="plugin-marketplace-switcher"
        aria-label={t("pluginMarketplace.view")}
        value={page}
        onValueChange={setPage}
        options={[
          { value: "installed", label: t("pluginMarketplace.installed") },
          { value: "marketplace", label: t("pluginMarketplace.catalog") },
        ]}
      />
    ) : null

  if (bridge && marketplace && page === "marketplace") {
    return (
      <SettingPage title={title} width="wide">
        {navigation}
        <PluginMarketplaceSettings
          bridge={marketplace}
          installer={bridge}
          membershipActive={membershipActive}
          onInstalled={refresh}
        />
      </SettingPage>
    )
  }

  return (
    <SettingPage
      title={title}
      sub={t("pluginSettings.description")}
      width="wide"
      actions={
        bridge && data && membershipActive && !loadError ? (
          <PluginInstallControls
            bridge={bridge}
            developerMode={data.developerMode}
            onError={setOperationError}
            onInstalled={refresh}
          />
        ) : null
      }
    >
      {navigation}
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
              <SearchField
                className="market-search"
                value={query}
                onValueChange={setQuery}
                placeholder={t("pluginSettings.search")}
                clearLabel={t("pluginSettings.clearSearch")}
              />
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
            </>
          ) : (
            <EmptyState
              className="group market-empty"
              icon={<Box className="ic" aria-hidden="true" />}
              title={t("pluginSettings.empty")}
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
    </SettingPage>
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
