// 主窗口从桌面入口接收的位置、会话授权和界面控制器。

import type { MembershipView } from "@pigclaude/contracts/membership"
import type { PreviewWorkbench } from "./fixtures/preview-workbench"
import type { AppearanceController } from "./hooks/use-appearance"
import type { BrowserProfilesController } from "./hooks/use-browser-profiles"
import type { ClaudeAccountsController } from "./hooks/use-claude-accounts"
import type { ProjectDrafts } from "./hooks/use-project-draft"
import type { NavLocation } from "./models/navigation"
import type { ResolvedTheme } from "./models/theme-model"

/** 主窗口由入口共享账号、工作区历史和草稿，避免页面分别维护陈旧的列表。 */
export type MainWindowProps = {
  location: NavLocation
  /** 整窗授权结束后，设置仍能返回历史中最近访问的主页面。 */
  lastWorkspace: NavLocation
  /** 开发预览和测试使用的页面名；导航以 location 为准。 */
  screen?: string
  canGoBack: boolean
  canGoForward: boolean
  membership: MembershipView
  drafts: ProjectDrafts
  claudeAccounts: ClaudeAccountsController
  browserProfiles?: BrowserProfilesController
  onNavigate: (location: NavLocation) => void
  /** 删除会话后把对应历史改为原项目草稿。 */
  onSessionsDeleted: (projects: ReadonlyMap<string, string>, selection: string | null) => void
  onBack: () => void
  onForward: () => void
  onOpenAuthorize: () => void
  onReauthorizeAccount?: (accountId: string) => void
  onLogout: () => void
  theme: ResolvedTheme
  appearance: AppearanceController
  /** 浏览器预览里代替桌面桥的演示工作台。 */
  previewWorkbench?: PreviewWorkbench | undefined
}
