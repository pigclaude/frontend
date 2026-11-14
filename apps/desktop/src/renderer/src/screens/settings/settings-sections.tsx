// 负责按当前设置子页选出对应的设置页面。
import type { AppearanceController } from "../../hooks/use-appearance"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { NavLocation } from "../../models/navigation"
import type { AppInfo } from "../../../../preload/index"
import type { ClaudeModel } from "../../../../main/session/session-types"
import type { SessionHistoryController } from "../../hooks/use-session-history"
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
  appInfo: AppInfo | null
  defaultWorkspace: string | null
  /** Claude Code 的模型目录，默认模型从这里选。 */
  models: readonly ClaudeModel[]
  /** 号池里的账号，新会话账号从这里选。 */
  accounts: readonly ClaudeAccountView[]
  history: SessionHistoryController
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
  models,
  accounts,
  history,
}: SettingsScreenProps) {
  if (page === "profile")
    return (
      <ProfileSettings
        membership={membership}
        onLogout={onLogout}
        withdrawContextId={withdrawContextId}
      />
    )
  if (page === "switching") return <SwitchingSettings accounts={accounts} onNavigate={onNavigate} />
  if (page === "general") return <GeneralSettings appVersion={appInfo?.appVersion ?? null} />
  if (page === "appearance") return <AppearancePage appearance={appearance} />
  if (page === "session")
    return <SessionSettings workspace={defaultWorkspace} models={models} history={history} />
  if (page === "menubar") return <MenubarSettings onNavigate={onNavigate} />
  if (page === "network") return <NetworkSettings />
  if (page === "data")
    return <DataSettings userDataPath={appInfo?.userDataPath ?? null} history={history} />
  return (
    <AboutSettings
      appVersion={appInfo?.appVersion ?? null}
      claudeCodeVersion={appInfo?.claudeCodeVersion ?? null}
    />
  )
}
