// 负责「通用」「会话」「托盘与菜单栏」三个应用设置页；「外观」见 appearance/appearance-page.tsx。
import { desktopText } from "../../locale/text"
import { useSidebarGrouping } from "@pigclaude/ui-primitives"
import { Button } from "../../components/ui/button"
import type { NavLocation } from "../../models/navigation"
import type { ClaudeModel } from "../../../../main/session/session-types"
import { LockedValue, Segmented } from "./setting-controls"
import { SettingPage, SettingRow, SettingSection } from "./setting-page"
import { DefaultModelRow, DefaultPermissionRow } from "./session-default-rows"
import { UpdateSettingsSection } from "./update-settings"

/** 通用：启动、Dock、快捷键、更新和侧栏会话分组。 */
export function GeneralSettings({ appVersion }: { appVersion: string | null }) {
  const [grouping, setGrouping] = useSidebarGrouping()
  return (
    <SettingPage title={desktopText("settings.settings-app-pages.1")}>
      <SettingSection title={desktopText("settings.settings-app-pages.2")}>
        <SettingRow title={desktopText("settings.settings-app-pages.3")} value="—" />
        <SettingRow title={desktopText("settings.settings-app-pages.4")} value="—" />
      </SettingSection>
      <SettingSection title={desktopText("settings.settings-app-pages.5")}>
        <SettingRow title={desktopText("settings.settings-app-pages.6")} value="—" />
      </SettingSection>
      <UpdateSettingsSection appVersion={appVersion} />
      <SettingSection title={desktopText("settings.settings-app-pages.10")}>
        <SettingRow title={desktopText("settings.settings-app-pages.11")}>
          <Segmented
            label={desktopText("settings.settings-app-pages.12")}
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: "project", label: desktopText("settings.settings-app-pages.13") },
              { value: "time", label: desktopText("settings.settings-app-pages.14") },
            ]}
          />
        </SettingRow>
      </SettingSection>
    </SettingPage>
  )
}

/** 会话：新会话的默认模型和默认权限（存在本机，新会话按它们初始化），以及会话进程的固定规则。 */
export function SessionSettings({
  workspace,
  models = [],
}: {
  workspace?: string | null
  models?: readonly ClaudeModel[]
}) {
  return (
    <SettingPage
      title={desktopText("settings.settings-app-pages.16")}
      sub={desktopText("settings.settings-app-pages.17")}
    >
      <SettingSection title={desktopText("settings.settings-app-pages.18")}>
        <SettingRow
          title={desktopText("settings.settings-app-pages.19")}
          description={workspace ?? "—"}
          mono
        />
        <DefaultModelRow models={models} />
        <DefaultPermissionRow />
      </SettingSection>
      <SettingSection title={desktopText("settings.settings-app-pages.28")}>
        <SettingRow
          title="Claude Code"
          description={desktopText("settings.settings-app-pages.29")}
          value="—"
        />
        <SettingRow
          title={desktopText("settings.settings-app-pages.33")}
          description={desktopText("settings.settings-app-pages.34")}
        >
          <LockedValue>{desktopText("settings.settings-app-pages.35")}</LockedValue>
        </SettingRow>
        <SettingRow
          title={desktopText("settings.settings-app-pages.36")}
          description={desktopText("settings.settings-app-pages.37")}
        >
          <LockedValue>{desktopText("settings.settings-app-pages.38")}</LockedValue>
        </SettingRow>
      </SettingSection>
    </SettingPage>
  )
}

/** 托盘与菜单栏：菜单栏文字和托盘面板内容。 */
export function MenubarSettings({ onNavigate }: { onNavigate: (location: NavLocation) => void }) {
  return (
    <SettingPage
      title={desktopText("settings.settings-app-pages.39")}
      actions={
        <Button variant="ghost" onClick={() => onNavigate({ kind: "tray" })}>
          {desktopText("settings.settings-app-pages.40")}
        </Button>
      }
    >
      <SettingSection>
        <SettingRow
          title={desktopText("settings.settings-app-pages.41")}
          description={desktopText("settings.settings-app-pages.42")}
          value="—"
        />
        <SettingRow
          title={desktopText("settings.settings-app-pages.43")}
          description={desktopText("settings.settings-app-pages.44")}
          value="—"
        />
        <SettingRow
          title={desktopText("settings.settings-app-pages.46")}
          description={desktopText("settings.settings-app-pages.47")}
          value="—"
        />
      </SettingSection>
    </SettingPage>
  )
}
