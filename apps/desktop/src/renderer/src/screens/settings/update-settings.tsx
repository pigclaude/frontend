// 负责设置页里的应用更新：「通用」页的自动检查开关和手动检查，以及「关于」页的更新状态文字。
import { useState } from "react"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import { Switch } from "@pigclaude/ui-primitives"
import { Button } from "../../components/ui/button"
import { useAppUpdates } from "../../hooks/use-app-updates"
import { desktopText } from "../../locale/text"
import type { UpdateResult } from "../../../../main/updates/update-service"
import { SettingRow, SettingSection } from "./setting-page"

/** 「通用」页的更新一节：开关和检查都走主进程；没有桌面桥时两者都不可用。 */
export function UpdateSettingsSection({ appVersion }: { appVersion: string | null }) {
  const updates = useAppUpdates()
  const [result, setResult] = useState<UpdateResult | null>(null)
  const unavailable = updates.state === null
  return (
    <SettingSection title={desktopText("settings.settings-app-pages.7")}>
      <SettingRow
        title={desktopText("settings.settings-app-pages.8")}
        description={desktopText("settings.settings-app-pages.9", {
          value1: String(appVersion ?? "—"),
        })}
      >
        <Switch
          aria-label={desktopText("settings.settings-app-pages.8")}
          checked={updates.state?.autoCheck ?? true}
          disabled={unavailable}
          onCheckedChange={(value) => void updates.setAutoCheck(value)}
        />
      </SettingRow>
      <SettingRow
        title={desktopText("appSettings.checkUpdates")}
        description={checkResultText(updates.checking, result)}
      >
        <Button
          size="sm"
          disabled={unavailable || updates.checking}
          onClick={() => void updates.check().then(setResult)}
        >
          {desktopText("appSettings.checkUpdates")}
        </Button>
      </SettingRow>
    </SettingSection>
  )
}

function checkResultText(checking: boolean, result: UpdateResult | null): string | undefined {
  if (checking) return desktopText("appSettings.updateChecking")
  if (!result) return undefined
  if (result.status === "up-to-date") return desktopText("appSettings.updateCurrent")
  if (result.status === "error") return desktopText("appSettings.updateCheckFailed")
  return desktopText("appSettings.updateAvailable", { version: result.version ?? "—" })
}

/** 「关于」页的更新状态：主进程还没给出状态时为 null，页面显示占位符。 */
export function updateStatusText(state: DesktopUpdateState | null): string | null {
  if (!state) return null
  if (state.phase === "checking") return desktopText("appSettings.updateChecking")
  if (state.phase === "downloading") {
    return desktopText("appSettings.updateDownloading", { progress: state.progress ?? 0 })
  }
  if (state.phase === "ready") {
    return desktopText("appSettings.updateReady", { version: state.version ?? "—" })
  }
  if (state.phase === "failed") return desktopText("appSettings.updateFailed")
  if (state.phase === "available") {
    return desktopText("appSettings.updateAvailable", { version: state.version ?? "—" })
  }
  return desktopText("appSettings.updateCurrent")
}
