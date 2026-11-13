// 负责中继、隐私与版本页，仅显示主进程已提供的运行时事实。
import { SettingPage, SettingRow, SettingSection } from "@pigclaude/ui-primitives"
import { ScrollPanel } from "@pigclaude/ui-shell"
import { useText } from "../../locale/text"

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
export function DataSettings({ userDataPath }: { userDataPath: string | null }) {
  const { t } = useText()
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

/** 显示本机版本；更新服务与内置 CLI 缺少数据时显示占位符。 */
export function AboutSettings({ appVersion }: { appVersion: string | null }) {
  const { t } = useText()
  return (
    <ScrollPanel>
      <SettingPage title={t("appSettings.about")} sub={t("appSettings.aboutDescription")}>
        <SettingSection title={t("appSettings.versions")}>
          <SettingRow title="PigClaude" value={appVersion ?? "—"} />
          <SettingRow title={t("appSettings.claudeCode")} value="—" />
          <SettingRow title={t("appSettings.updateStatus")} value="—" />
        </SettingSection>
      </SettingPage>
    </ScrollPanel>
  )
}
