// 负责登录后的主窗口：侧栏收起与抽屉、窗口快捷键和内容区页面路由。
// 聊天、账号、代理、环境、用量和托盘都接真实会话与本地数据，不再注入 fixture。

import { useEffect, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { AccountsScreen } from "./screens/accounts-screen"
import { ChatScreen } from "./screens/chat-screen"
import { EnvironmentScreen } from "./screens/environment-screen"
import { ProxiesScreen } from "./screens/proxies-screen"
import { SettingsScreen } from "./screens/settings/settings-sections"
import { TrayScreen } from "./screens/tray-screen"
import { UsageScreen } from "./screens/usage-screen"
import { AddProjectDialog } from "./components/add-project-dialog"
import { ScrollPanel, Sidebar, WindowControls } from "./components/shell"
import { useToast } from "./components/toast"
import { useClaudeAccounts } from "./hooks/use-claude-accounts"
import { useSession } from "./hooks/use-session"
import { useWorkspaces } from "./hooks/use-workspaces"
import { projectNameFromPath, type Project } from "./models/project-model"
import { toPoolAccount, toPoolProxy } from "./models/claude-account-view"
import { settingsScreens } from "./models/settings-nav"
import type { ProjectNavigationState } from "./models/navigation-model"
import type { AppearanceController } from "./hooks/use-appearance"
import type { ResolvedTheme } from "./models/theme-model"
import type { Screen } from "./screens/screen"
import { Button } from "./components/ui/button"

const narrowQuery = "(max-width: 960px)"

/** 主窗口需要的页面状态与事件。 */
export type MainWindowProps = {
  screen: Screen
  canGoBack: boolean
  canGoForward: boolean
  membership: MembershipView
  onNavigate: (screen: Screen) => void
  onBack: () => void
  onForward: () => void
  onOpenAuthorize: () => void
  onReauthorizeAccount?: (accountId: string) => void
  onLogout: () => void
  theme: ResolvedTheme
  appearance: AppearanceController
}

/** 画出侧栏和内容区；窄窗口里侧栏变成可开合的抽屉。 */
export function MainWindow({
  screen,
  canGoBack,
  canGoForward,
  membership,
  onNavigate,
  onBack,
  onForward,
  onOpenAuthorize,
  onReauthorizeAccount,
  onLogout,
  theme,
  appearance,
}: MainWindowProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia(narrowQuery).matches)
  const [lastWorkspace, setLastWorkspace] = useState<Screen>("chat")
  const [navigation, setNavigation] = useState<ProjectNavigationState>({ expandedProjects: {} })
  const [addingProject, setAddingProject] = useState(false)
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const toast = useToast()
  const pool = useClaudeAccounts()
  const session = useSession()
  const workspaces = useWorkspaces()
  const accounts = pool.accounts.map((account) => toPoolAccount(account, pool.proxies))
  const proxies = pool.proxies.map((proxy) => toPoolProxy(proxy, pool.accounts))
  const projects: Project[] = workspaces.paths.map((path) => ({
    id: path,
    name: projectNameFromPath(path),
    sessions: [],
  }))
  const workspace = selectedWorkspace ?? workspaces.paths[0] ?? null
  const inSettings = settingsScreens.has(screen)

  useEffect(() => {
    if (!settingsScreens.has(screen) && screen !== "tray") setLastWorkspace(screen)
    setDrawerOpen(false)
  }, [screen])

  useEffect(() => {
    const query = window.matchMedia(narrowQuery)
    const onChange = (event: MediaQueryListEvent) => {
      setNarrow(event.matches)
      setDrawerOpen(false)
    }
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  function toggleSidebar(): void {
    if (narrow) setDrawerOpen((open) => !open)
    else setCollapsed((value) => !value)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && drawerOpen) setDrawerOpen(false)
      if (!event.metaKey && !event.ctrlKey) return
      const actions: Record<string, () => void> = {
        "\\": toggleSidebar,
        "[": onBack,
        "]": onForward,
        ",": () => onNavigate("general"),
        n: () => onNavigate("chat-new"),
      }
      const action = actions[event.key]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const appClass = [
    "app",
    collapsed ? "is-collapsed" : "",
    drawerOpen ? "is-drawer-open" : "",
    inSettings ? "is-settings" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div className={appClass}>
      <WindowControls
        sidebarOpen={narrow ? drawerOpen : !collapsed}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onToggleSidebar={toggleSidebar}
        onBack={onBack}
        onForward={onForward}
      />
      <Sidebar
        screen={screen}
        projects={projects}
        navigation={navigation}
        onAddProject={() => setAddingProject(true)}
        onNavigate={onNavigate}
        onExitSettings={() => onNavigate(lastWorkspace)}
        onToggleProject={(projectId, expanded) =>
          setNavigation((current) => ({
            expandedProjects: { ...current.expandedProjects, [projectId]: expanded },
          }))
        }
        onNewSession={(projectId) => {
          if (projectId !== undefined && workspaces.paths.includes(projectId)) {
            setSelectedWorkspace(projectId)
          }
          onNavigate("chat-new")
        }}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={() =>
          appearance.update((current) => ({
            ...current,
            mode: theme === "light" ? "dark" : "light",
          }))
        }
      />
      <AddProjectDialog
        open={addingProject}
        onOpenChange={setAddingProject}
        onAdd={(path) => {
          void workspaces
            .add(path)
            .then(() => {
              setSelectedWorkspace(path)
              toast(`已添加工作区 ${projectNameFromPath(path)}`, "folder")
            })
            .catch((error: unknown) => toast(workspaceErrorMessage(error), "info"))
        }}
      />
      <Button
        variant="plain"
        className="drawer-scrim"
        type="button"
        aria-label="关闭侧栏"
        tabIndex={-1}
        onClick={() => setDrawerOpen(false)}
      />
      <main className="panel">
        {screen === "chat" || screen === "chat-new" ? (
          <ChatScreen
            fresh={screen === "chat-new"}
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
                .catch((error: unknown) => toast(workspaceErrorMessage(error), "info"))
            }}
            onSelectWorkspace={setSelectedWorkspace}
            onWorkspaceUsed={(path) => {
              setSelectedWorkspace(path)
              void workspaces.add(path).catch(() => undefined)
            }}
            onOpen={onNavigate}
            smartPunctuation={appearance.settings.smartPunctuation}
          />
        ) : null}
        {screen === "tray" ? (
          <TrayScreen
            membership={membership}
            accounts={pool.accounts}
            onOpenAccounts={() => onNavigate("accounts")}
            onOpenSettings={() => onNavigate("general")}
          />
        ) : null}
        {screen === "accounts" ? (
          <ScrollPanel>
            <AccountsScreen
              accounts={accounts}
              proxies={proxies}
              error={pool.error}
              onOpenAuthorize={onOpenAuthorize}
              onReauthorize={(accountId) => onReauthorizeAccount?.(accountId) ?? onOpenAuthorize()}
              onRemove={(accountId) => void pool.remove(accountId)}
              onUpdate={(input) => void pool.update(input)}
            />
          </ScrollPanel>
        ) : null}
        {screen === "proxies" ? (
          <ScrollPanel>
            <ProxiesScreen
              proxies={proxies}
              error={pool.error}
              onTest={(proxyId) => pool.testProxy(proxyId)}
              onSave={(input) => pool.saveProxy(input)}
              onRemove={(proxyId) => void pool.removeProxy(proxyId)}
            />
          </ScrollPanel>
        ) : null}
        {screen === "usage" ? (
          <ScrollPanel>
            <UsageScreen />
          </ScrollPanel>
        ) : null}
        {screen === "environment" ? (
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
        ) : null}
        {inSettings && !["accounts", "proxies", "usage", "environment"].includes(screen) ? (
          <SettingsScreen
            key={screen}
            screen={screen}
            appearance={appearance}
            onNavigate={onNavigate}
            onLogout={onLogout}
          />
        ) : null}
      </main>
    </div>
  )
}

function workspaceErrorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : "工作区不可用"
}
