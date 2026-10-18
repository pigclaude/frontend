// 负责按当前设置子页选出对应的设置页面。
import type { AppearanceController } from "../../hooks/use-appearance"
import type { Screen } from "../screen"
import { ProfileSettings, SwitchingSettings } from "./settings-account-pages"
import { AppearancePage } from "./appearance/appearance-page"
import { GeneralSettings, MenubarSettings, SessionSettings } from "./settings-app-pages"
import { AboutSettings, DataSettings, NetworkSettings } from "./settings-system-pages"

/** 设置页面 props。 */
export type SettingsScreenProps = {
  screen: Screen
  appearance: AppearanceController
  onNavigate: (screen: Screen) => void
  onLogout: () => void
}

/** 根据当前设置子页绘制原型对应的设置内容；未知子页显示关于。 */
export function SettingsScreen({ screen, appearance, onNavigate, onLogout }: SettingsScreenProps) {
  if (screen === "profile") return <ProfileSettings onLogout={onLogout} />
  if (screen === "switching") return <SwitchingSettings onNavigate={onNavigate} />
  if (screen === "general") return <GeneralSettings />
  if (screen === "appearance") return <AppearancePage appearance={appearance} />
  if (screen === "session") return <SessionSettings />
  if (screen === "menubar") return <MenubarSettings onNavigate={onNavigate} />
  if (screen === "network") return <NetworkSettings />
  if (screen === "data") return <DataSettings />
  return <AboutSettings />
}
