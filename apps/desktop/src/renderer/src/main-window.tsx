// 负责登录后的主窗口：把工作区、当前会话和账号状态接到 Pigcode 外壳，并按当前位置画内容区页面。
// 聊天、账号、代理、环境、用量和托盘都接真实会话与本地数据，不再注入 fixture。
import { useEffect, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { ScrollPanel, useToast } from "@pigclaude/ui-shell"
import { AccountsScreen } from "./screens/accounts-screen"
import { ChatScreen } from "./screens/chat-screen"
import { EnvironmentScreen } from "./screens/environment-screen"
import { ProxiesScreen } from "./screens/proxies-screen"
import { BrowserProfilesScreen } from "./screens/browser-profiles-screen"
import type { BrowserProfilesController } from "./hooks/use-browser-profiles"
import { SettingsScreen } from "./screens/settings/settings-sections"
import { TrayScreen } from "./screens/tray-screen"
import { UsageScreen } from "./screens/usage-screen"
import type { ClaudeAccountsController } from "./hooks/use-claude-accounts"
import { useSession } from "./hooks/use-session"
import { useWorkspaces } from "./hooks/use-workspaces"
import { fill, useText } from "./locale/text"
import { projectNameFromPath } from "./models/project-model"
import { toPoolAccount, toPoolProxy } from "./models/claude-account-view"
import type { NavLocation } from "./models/navigation"
import type { AppearanceController } from "./hooks/use-appearance"
import type { ResolvedTheme } from "./models/theme-model"
import { AddProjectDialog } from "./shell/add-project-dialog"
import { PigclaudeShell } from "./shell/pigclaude-shell"
import { SettingsSidebar } from "./shell/settings-sidebar"
import { SidebarFooter } from "./shell/sidebar-footer"
import { SidebarNotice } from "./shell/sidebar-notice"
import {
  SettingsContributionView,
  SettingsRegistry,
  settingsLocation,
  type SettingsPageRenderer,
} from "./shell/settings-registry"
import {
  agentNames,
  newSessionWorkspace,
  sessionStatus,
  sessionThread,
  toggleExpanded,
  workspaceProjects,
} from "./shell/workspace-threads"

/** 主窗口需要的位置状态与事件；账号控制器由 App 持有，避免同一页面出现两份陈旧列表。 */
export type MainWindowProps = {
  location: NavLocation
  /** 旧测试和开发预览使用的页面名；导航本身以 location 为唯一状态。 */
  screen?: string
  canGoBack: boolean
  canGoForward: boolean
  membership: MembershipView
  claudeAccounts: ClaudeAccountsController
  browserProfiles?: BrowserProfilesController
  onNavigate: (location: NavLocation) => void
  onBack: () => void
  onForward: () => void
  onOpenAuthorize: () => void
  onReauthorizeAccount?: (accountId: string) => void
  onLogout: () => void
  theme: ResolvedTheme
  appearance: AppearanceController
}

/** 画外壳与内容区；离开设置时回到离开前的工作区位置。 */
export function MainWindow({
  location,
  screen,
  canGoBack,
  canGoForward,
  membership,
  claudeAccounts,
  browserProfiles,
  onNavigate,
  onBack,
  onForward,
  onOpenAuthorize,
  onReauthorizeAccount,
  onLogout,
  theme,
  appearance,
}: MainWindowProps) {
  const { t } = useText()
  const toast = useToast()
  const pool = claudeAccounts
  const session = useSession()
  const workspaces = useWorkspaces()
  const [lastWorkspace, setLastWorkspace] = useState<NavLocation>({ kind: "session" })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [addingProject, setAddingProject] = useState(false)
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [sessionWorkspace, setSessionWorkspace] = useState<string | null>(null)
  const [sessionStartedAt, setSessionStartedAt] = useState(() => new Date().toISOString())
  const [appInfo, setAppInfo] = useState<{
    appVersion: string
    userDataPath: string
  } | null>(null)
  const accounts = pool.accounts.map((account) => toPoolAccount(account, pool.proxies))
  const proxies = pool.proxies.map((proxy) => toPoolProxy(proxy, pool.accounts))
  const workspace = selectedWorkspace ?? workspaces.paths[0] ?? null
  const sessionId = session.state.sessionId
  const thread = sessionThread({
    session: session.state,
    workspace: sessionWorkspace,
    startedAt: sessionStartedAt,
    untitled: t("shell.session.untitled"),
  })
  const page = location.kind === "settings" ? location.page : null

  useEffect(() => {
    if (location.kind === "draft" || location.kind === "session") setLastWorkspace(location)
  }, [location])

  useEffect(() => {
    if (sessionId) setSessionStartedAt(new Date().toISOString())
  }, [sessionId])

  useEffect(() => {
    const read = window.pigclaude?.appInfo
    if (!read) return
    void read()
      .then(setAppInfo)
      .catch(() => undefined)
  }, [])

  function settings(next: string): void {
    onNavigate(settingsLocation(next))
  }

  function newSession(projectId?: string): void {
    setSelectedWorkspace(newSessionWorkspace(projectId, workspaces.paths, selectedWorkspace))
    onNavigate({ kind: "draft" })
  }

  function addWorkspace(path: string): void {
    void workspaces
      .add(path)
      .then(() => {
        setSelectedWorkspace(path)
        toast(fill(t("shell.project.added"), { name: projectNameFromPath(path) }), "folder")
      })
      .catch((error: unknown) => toast(workspaceErrorMessage(error, t), "info"))
  }

  const renderSettingsPage: SettingsPageRenderer = (page) => {
    if (page === "accounts") {
      return (
        <ScrollPanel>
          <AccountsScreen
            accounts={accounts}
            proxies={proxies}
            browserProfiles={browserProfiles?.profiles}
            onOpenBrowserProfiles={() => settings("browser-profiles")}
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
        page={page}
        appearance={appearance}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />
    )
  }

  return (
    <PigclaudeShell
      {...(screen === undefined ? {} : { dataScreen: screen })}
      inSettings={page !== null}
      locationKey={page ?? location.kind}
      projects={workspaceProjects(workspaces.paths)}
      threads={thread ? [thread] : []}
      activeThreadId={location.kind === "session" ? (thread?.id ?? null) : null}
      threadStatus={thread ? { [thread.id]: sessionStatus(session.state) } : {}}
      agentNames={agentNames}
      expandedProjects={expanded}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={onBack}
      onForward={onForward}
      onToggleProject={(projectId, open) =>
        setExpanded((current) => toggleExpanded(current, projectId, open))
      }
      onNewSession={newSession}
      onOpenThread={() => onNavigate({ kind: "session" })}
      onAddProject={() => setAddingProject(true)}
      onOpenSettings={() => settings("general")}
      onAbout={() => settings("about")}
      settingsSidebar={
        <SettingsSidebar
          activePage={page ?? "general"}
          onSelect={(next) => settings(next)}
          onExit={() => onNavigate(lastWorkspace)}
        />
      }
      notice={
        <SidebarNotice
          accounts={accounts.filter((account) => account.needsReauth)}
          onOpen={() => settings("accounts")}
        />
      }
      footer={
        <SidebarFooter
          account={membership.account}
          theme={theme}
          onOpenProfile={() => settings("profile")}
          onOpenClaudeAccounts={() => settings("accounts")}
          onOpenSettings={() => settings("general")}
          onToggleTheme={() =>
            appearance.update((current) => ({
              ...current,
              mode: theme === "light" ? "dark" : "light",
            }))
          }
          onLogout={onLogout}
        />
      }
    >
      <SettingsRegistry render={renderSettingsPage} onSelect={settings} />
      <AddProjectDialog open={addingProject} onOpenChange={setAddingProject} onAdd={addWorkspace} />
      {location.kind === "draft" || location.kind === "session" ? (
        <ChatScreen
          fresh={location.kind === "draft"}
          session={session}
          workspace={workspace}
          workspaceOptions={workspaces.paths}
          accounts={pool.accounts}
          proxies={pool.proxies}
          onPickWorkspace={() => {
            void workspaces
              .pick()
              .then((path) => {
                if (path !== null) setSelectedWorkspace(path)
              })
              .catch((error: unknown) => toast(workspaceErrorMessage(error, t), "info"))
          }}
          onSelectWorkspace={setSelectedWorkspace}
          onWorkspaceUsed={(path) => {
            setSelectedWorkspace(path)
            setSessionWorkspace(path)
            void workspaces.add(path).catch(() => undefined)
          }}
          onOpen={onNavigate}
          smartPunctuation={appearance.settings.smartPunctuation}
        />
      ) : null}
      {location.kind === "tray" ? (
        <TrayScreen
          membership={membership}
          accounts={pool.accounts}
          onOpenAccounts={() => settings("accounts")}
          onOpenSettings={() => settings("general")}
        />
      ) : null}
      {page !== null ? <SettingsContributionView page={page} /> : null}
    </PigclaudeShell>
  )
}

function workspaceErrorMessage(error: unknown, t: ReturnType<typeof useText>["t"]): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : t("shell.project.unavailable")
}
