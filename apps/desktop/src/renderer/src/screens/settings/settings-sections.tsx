// 负责按当前设置子页选出对应的设置页面。
import type { ThemePreference } from "../../models/theme-model"
import type { Screen } from "../screen"
import { ProfileSettings, SwitchingSettings } from "./settings-account-pages"
import {
  AppearanceSettings,
  GeneralSettings,
  MenubarSettings,
  SessionSettings,
} from "./settings-app-pages"
import { AboutSettings, DataSettings, NetworkSettings } from "./settings-system-pages"

/** 设置页面 props。 */
export type SettingsScreenProps = {
  screen: Screen
  themePreference: ThemePreference
  onThemePreference: (preference: ThemePreference) => void
  onNavigate: (screen: Screen) => void
  onLogout: () => void
}

/** 根据当前设置子页绘制原型对应的设置内容；未知子页显示关于。 */
export function SettingsScreen({
  screen,
  themePreference,
  onThemePreference,
  onNavigate,
  onLogout,
}: SettingsScreenProps) {
  if (screen === "profile") return <ProfileSettings onLogout={onLogout} />
  if (screen === "switching") return <SwitchingSettings onNavigate={onNavigate} />
  if (screen === "general") return <GeneralSettings />
  if (screen === "appearance")
    return (
      <AppearanceSettings themePreference={themePreference} onThemePreference={onThemePreference} />
    )
  if (screen === "session") return <SessionSettings />
  if (screen === "menubar") return <MenubarSettings onNavigate={onNavigate} />
  if (screen === "network") return <NetworkSettings />
  if (screen === "data") return <DataSettings />
  return <AboutSettings />
}
