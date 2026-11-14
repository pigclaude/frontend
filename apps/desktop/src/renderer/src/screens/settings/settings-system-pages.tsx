// 负责中继、隐私与版本页，仅显示主进程已提供的运行时事实。
import { Button, SettingPage, SettingRow, SettingSection } from "@pigclaude/ui-primitives"
import { ScrollPanel } from "@pigclaude/ui-shell"
import { useAppUpdates } from "../../hooks/use-app-updates"
import { fill, useText } from "../../locale/text"
import type { SessionHistoryController } from "../../hooks/use-session-history"
import { updateStatusText } from "./update-settings"

/** 展示中继与代理策略；暂无运行信息的字段显示占位符。 */
export function NetworkSettings() {
  const { t } = useText()
  return (
    <ScrollPanel>
      <SettingPage title={t("appSettings.network")}>
        <SettingSection title={t("appSettings.relay")}>
          <SettingRow
            title={t("appSettings.relayPort")}
            description={t("appSettings.relayUnavailable")}
            value="—"
          />
          <SettingRow
            title={t("appSettings.relayRestart")}
            description={t("appSettings.relayUnavailable")}
            value="—"
          />
        </SettingSection>
        <SettingSection title={t("appSettings.proxies")}>
          <SettingRow
            title={t("appSettings.proxyOptional")}
            description={t("appSettings.proxyOptionalDetail")}
            value={t("appSettings.proxyBinding")}
          />
          <SettingRow
            title={t("appSettings.proxyFailure")}
            description={t("appSettings.proxyFailureDetail")}
            value={t("appSettings.proxyNoFallback")}
          />
          <SettingRow
            title={t("appSettings.proxyRecheck")}
            description={t("appSettings.proxyRecheckDetail")}
            value="—"
          />
        </SettingSection>
      </SettingPage>
    </ScrollPanel>
  )
}

/** 展示本机数据目录与已接入的存储信息。 */
export function DataSettings({
  userDataPath,
  history,
}: {
  userDataPath: string | null
  history?: SessionHistoryController
}) {
  const { t, locale } = useText()
  return (
    <ScrollPanel>
      <SettingPage title={t("appSettings.privacy")} sub={t("appSettings.privacyDescription")}>
        <SettingSection title={t("appSettings.dataDirectory")}>
          <SettingRow
            title={t("appSettings.dataDirectory")}
            value={<code>{userDataPath ?? "—"}</code>}
          />
          <SettingRow title="accounts.json" description={t("appSettings.accountsFile")} value="—" />
          <SettingRow title="proxies.json" description={t("appSettings.proxiesFile")} value="—" />
        </SettingSection>
        {history?.enabled ? (
          <SettingSection title={t("shell.session.storage")}>
            {history.loadError === null ? null : (
              <p className="error-text" role="alert">
                {history.loadError}
              </p>
            )}
            <SettingRow
              title={t("shell.session.storage")}
              value={
                history.stats === null
                  ? "—"
                  : fill(t("shell.session.storageValue"), {
                      bytes: new Intl.NumberFormat(locale, { style: "unit", unit: "byte" }).format(
                        history.stats.bytes,
                      ),
                      count: history.stats.count,
                    })
              }
            />
            <SettingRow title={t("shell.session.clear")}>
              <Button
                variant="ghost"
                disabled={!history.canClear || history.stats === null || history.stats.count === 0}
                onClick={() => history.promptDeletion({ kind: "all" })}
              >
                {t("shell.session.clear")}
              </Button>
            </SettingRow>
          </SettingSection>
        ) : null}
        <SettingSection title={t("appSettings.usageRecords")}>
          <SettingRow
            title={t("appSettings.retention")}
            description={t("appSettings.metadataOnly")}
            value={t("appSettings.retentionPeriod")}
          />
          <SettingRow title={t("appSettings.clearUsage")} value="—" />
        </SettingSection>
      </SettingPage>
    </ScrollPanel>
  )
}

/** 显示本机版本、随包 Claude Code 的版本和更新状态；读不到的显示占位符。 */
export function AboutSettings({
  appVersion,
  claudeCodeVersion = null,
}: {
  appVersion: string | null
  claudeCodeVersion?: string | null
}) {
  const { t } = useText()
  const updateStatus = updateStatusText(useAppUpdates().state)
  return (
    <ScrollPanel>
      <SettingPage title={t("appSettings.about")} sub={t("appSettings.aboutDescription")}>
        <SettingSection title={t("appSettings.versions")}>
          <SettingRow title="PigClaude" value={appVersion ?? "—"} />
          <SettingRow title={t("appSettings.claudeCode")} value={claudeCodeVersion ?? "—"} />
          <SettingRow title={t("appSettings.updateStatus")} value={updateStatus ?? "—"} />
        </SettingSection>
      </SettingPage>
    </ScrollPanel>
  )
}
