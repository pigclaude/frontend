// 负责通用设置的登录启动开关，以及仅 macOS 可用的 Dock 显示开关。

import { useEffect, useState } from "react"
import type {
  StartupPreference,
  StartupPreferencesView,
} from "../../../../startup-preferences-contract"
import { Switch } from "../../components/ui/switch"
import { desktopText } from "../../locale/text"
import { SettingRow, SettingSection } from "./setting-page"

/** 展示系统确认的启动偏好。修改失败时保留原值并显示提示。 */
export function StartupSettings() {
  const bridge = window.pigclaude?.startupPreferences
  const isMac = window.pigclaude?.platform === "darwin"
  const [view, setView] = useState<StartupPreferencesView | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<StartupPreference | null>(null)

  useEffect(() => {
    let active = true
    void bridge?.get().then(
      (next) => {
        if (active) setView(next)
      },
      () => {
        if (active) setFailed("openAtLogin")
      },
    )
    return () => {
      active = false
    }
  }, [bridge])

  async function update(preference: StartupPreference, enabled: boolean): Promise<void> {
    if (bridge === undefined || busy) return
    setBusy(true)
    setFailed(null)
    try {
      const saved = await bridge.set(preference, enabled)
      setView((current) => (current === null ? null : { ...current, [preference]: saved }))
    } catch {
      setFailed(preference)
    } finally {
      setBusy(false)
    }
  }

  function row(preference: StartupPreference, title: string) {
    const value = view?.[preference] ?? null
    return (
      <SettingRow
        title={title}
        value={value === null ? "—" : undefined}
        description={
          failed === preference ? (
            <span role="alert">{desktopText("settings.startupPreferenceFailed")}</span>
          ) : undefined
        }
      >
        {value === null ? null : (
          <Switch
            checked={value}
            disabled={busy}
            aria-label={title}
            onCheckedChange={(next) => void update(preference, next)}
          />
        )}
      </SettingRow>
    )
  }

  return (
    <SettingSection title={desktopText("settings.settings-app-pages.2")}>
      {row("openAtLogin", desktopText("settings.settings-app-pages.3"))}
      {isMac ? row("showInDock", desktopText("settings.settings-app-pages.4")) : null}
    </SettingSection>
  )
}
