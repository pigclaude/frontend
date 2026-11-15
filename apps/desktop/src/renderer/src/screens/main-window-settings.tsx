// 负责主窗口的设置内容区，复用主窗口所持有的账号、会话与工作区控制器。

import type { MembershipView } from "@pigclaude/contracts/membership"
import { ScrollPanel } from "@pigclaude/ui-shell"
import type { AppInfo } from "../../../preload/index"
import type { AppearanceController } from "../hooks/use-appearance"
import type { BrowserProfilesController } from "../hooks/use-browser-profiles"
import type { ClaudeAccountsController } from "../hooks/use-claude-accounts"
import type { SessionController } from "../hooks/use-session"
import type { SessionHistoryController } from "../hooks/use-session-history"
import type { WorkspacesController } from "../hooks/use-workspaces"
import { toPoolAccount, toPoolProxy } from "../models/claude-account-view"
import type { NavLocation } from "../models/navigation"
import { AccountsScreen } from "./accounts-screen"
import { BrowserProfilesScreen } from "./browser-profiles-screen"
import { EnvironmentScreen } from "./environment-screen"
import { ProxiesScreen } from "./proxies-screen"
import { SettingsScreen } from "./settings/settings-sections"
import { UsageScreen } from "./usage-screen"
import { ArchivedSessions } from "./settings/archived-sessions"
import { ScheduledTasksSettings } from "./settings/scheduled-tasks-settings"

type Props = {
  page: string
  membership: MembershipView
  pool: ClaudeAccountsController
  browserProfiles: BrowserProfilesController | undefined
  session: SessionController
  history: SessionHistoryController
  canSelectWorkspace: (workspace: string) => boolean
  workspace: string | null
  workspaces: Pick<WorkspacesController, "paths" | "names">
  appInfo: AppInfo | null
  appearance: AppearanceController
  onOpenAuthorize: () => void
  onReauthorizeAccount: ((accountId: string) => void) | undefined
  onOpenSettings: (page: string) => void
  onNavigate: (location: NavLocation) => void
  onLogout: () => void
}

/** 绘制选定的设置页，沿用已打开窗口的账号和会话数据。 */
export function MainWindowSettings({
  page,
  membership,
  pool,
  browserProfiles,
  session,
  history,
  canSelectWorkspace,
  workspace,
  workspaces,
  appInfo,
  appearance,
  onOpenAuthorize,
  onReauthorizeAccount,
  onOpenSettings,
  onNavigate,
  onLogout,
}: Props) {
  if (page === "scheduled-tasks")
    return (
      <ScheduledTasksSettings
        bridge={window.pigclaude?.scheduledTasks}
        projectPaths={workspaces.paths}
        projectNames={workspaces.names}
        currentProject={workspace}
        accounts={pool.accounts}
        models={session.models}
        modelsLoading={session.modelsLoading}
        loadModels={session.refreshModels}
        openSession={(sessionId, projectPath) => {
          const target = history.summaryForSession(sessionId)?.workspace ?? projectPath
          if (canSelectWorkspace(target)) onNavigate({ kind: "session", sessionId })
        }}
      />
    )
  const accounts = pool.accounts.map((account) => toPoolAccount(account, pool.proxies))
  if (page === "archived")
    return (
      <ArchivedSessions
        history={history}
        onOpen={({ workspace, sessionId }) => {
          if (canSelectWorkspace(workspace)) onNavigate({ kind: "session", sessionId })
        }}
      />
    )
  const proxies = pool.proxies.map((proxy) => toPoolProxy(proxy, pool.accounts))
  if (page === "accounts") {
    return (
      <ScrollPanel>
        <AccountsScreen
          accounts={accounts}
          proxies={proxies}
          browserProfiles={browserProfiles?.profiles}
          onOpenBrowserProfiles={() => onOpenSettings("browser-profiles")}
          error={pool.error}
          onOpenAuthorize={onOpenAuthorize}
          onReauthorize={(accountId) => {
            if (onReauthorizeAccount) onReauthorizeAccount(accountId)
            else onOpenAuthorize()
          }}
          onRemove={(accountId) => void pool.remove(accountId)}
          onUpdate={(input) => void pool.update(input)}
          onImportFromClaudeCli={(browserProfileId) =>
            pool.importFromClaudeCli({ confirmCopy: true, browserProfileId })
          }
        />
      </ScrollPanel>
    )
  }
  if (page === "proxies") {
    return (
      <ScrollPanel>
        <ProxiesScreen
          proxies={proxies}
          error={pool.error}
          onTest={(proxyId) => pool.testProxy(proxyId)}
          onSave={(input) => pool.saveProxy(input)}
          onRemove={(proxyId) => void pool.removeProxy(proxyId)}
        />
      </ScrollPanel>
    )
  }
  if (page === "browser-profiles" && browserProfiles) {
    return (
      <ScrollPanel>
        <BrowserProfilesScreen controller={browserProfiles} proxies={pool.proxies} />
      </ScrollPanel>
    )
  }
  if (page === "usage")
    return (
      <ScrollPanel>
        <UsageScreen />
      </ScrollPanel>
    )
  if (page === "environment") {
    return (
      <ScrollPanel>
        <EnvironmentScreen
          accounts={pool.accounts}
          proxies={pool.proxies}
          status={session.status}
          models={session.models}
          modelsLoading={session.modelsLoading}
          modelsError={session.modelsError}
          modelsCliError={session.modelsCliError}
          onLoadModels={() => void session.refreshModels()}
          onCancelModels={session.cancelModels}
          onRecheck={() => {
            void session.refreshStatus()
            void session.refreshModels(true)
            void pool.refresh()
          }}
          onCheckEgress={(proxyId) => pool.checkEgress(proxyId)}
        />
      </ScrollPanel>
    )
  }
  return (
    <SettingsScreen
      withdrawContextId={membership.actionContextId}
      membership={membership}
      appInfo={appInfo}
      defaultWorkspace={workspace}
      models={session.models}
      history={history}
      accounts={pool.accounts}
      page={page}
      appearance={appearance}
      onNavigate={onNavigate}
      onLogout={onLogout}
    />
  )
}
