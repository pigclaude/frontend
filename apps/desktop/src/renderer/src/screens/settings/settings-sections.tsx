// 负责按当前设置子页选出对应的设置页面。
import type { AppearanceController } from "../../hooks/use-appearance"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { NavLocation } from "../../models/navigation"
import { ProfileSettings, SwitchingSettings } from "./settings-account-pages"
import { AppearancePage } from "./appearance/appearance-page"
import { GeneralSettings, MenubarSettings, SessionSettings } from "./settings-app-pages"
import { AboutSettings, DataSettings, NetworkSettings } from "./settings-system-pages"

/** 设置页面 props。 */
export type SettingsScreenProps = {
  withdrawContextId?: string | undefined
  page: string
  appearance: AppearanceController
  onNavigate: (location: NavLocation) => void
  onLogout: () => void
  membership: MembershipView
  appInfo: { appVersion: string; userDataPath: string } | null
  defaultWorkspace: string | null
  defaultModel: string | null
}

/** 根据当前设置子页绘制原型对应的设置内容；未知子页显示关于。 */
export function SettingsScreen({
  page,
  appearance,
  onNavigate,
  onLogout,
  withdrawContextId,
  membership,
  appInfo,
  defaultWorkspace,
  defaultModel,
}: SettingsScreenProps) {
  if (page === "profile")
    return (
      <ProfileSettings
        membership={membership}
        onLogout={onLogout}
        withdrawContextId={withdrawContextId}
      />
    )
  if (page === "switching") return <SwitchingSettings onNavigate={onNavigate} />
  if (page === "general") return <GeneralSettings appVersion={appInfo?.appVersion ?? null} />
  if (page === "appearance") return <AppearancePage appearance={appearance} />
  if (page === "session")
    return <SessionSettings workspace={defaultWorkspace} defaultModel={defaultModel} />
  if (page === "menubar") return <MenubarSettings onNavigate={onNavigate} />
  if (page === "network") return <NetworkSettings />
  if (page === "data") return <DataSettings userDataPath={appInfo?.userDataPath ?? null} />
  return <AboutSettings appVersion={appInfo?.appVersion ?? null} />
}
