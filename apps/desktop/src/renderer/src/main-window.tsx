// 负责登录后的主窗口：侧栏收起与抽屉、窗口快捷键和内容区页面路由。
import { useEffect, useState } from "react"
import { AccountsScreen } from "./screens/accounts-screen"
import { ChatScreen } from "./screens/chat-screen"
import { EnvironmentScreen } from "./screens/environment-screen"
import { OnboardingScreen } from "./screens/onboarding-screen"
import { ProxiesScreen } from "./screens/proxies-screen"
import { SettingsScreen } from "./screens/settings/settings-sections"
import { TrayScreen } from "./screens/tray-screen"
import { UsageScreen } from "./screens/usage-screen"
import { AddProjectDialog } from "./components/add-project-dialog"
import { ScrollPanel, Sidebar, WindowControls } from "./components/shell"
import { useToast } from "./components/toast"
import { sessionFixture } from "./fixtures/chat-fixtures"
import {
  operationsEnvironmentFixture,
  operationsUsageFixture,
} from "./fixtures/operations-fixtures"
import { projectFixtures } from "./fixtures/project-fixtures"
import type { ProjectNavigationState } from "./models/navigation-model"
import { addProject } from "./models/project-model"
import { createPoolState } from "./models/pool-model"
import { settingsScreens } from "./models/settings-nav"
import type { ResolvedTheme, ThemePreference } from "./models/theme-model"
import type { Screen } from "./screens/screen"
import { Button } from "./components/ui/button"

const narrowQuery = "(max-width: 960px)"

/** 主窗口需要的页面状态与事件。 */
export type MainWindowProps = {
  screen: Screen
  canGoBack: boolean
  canGoForward: boolean
  onNavigate: (screen: Screen) => void
  onBack: () => void
  onForward: () => void
  onOpenAuthorize: () => void
  onLogout: () => void
  theme: ResolvedTheme
  themePreference: ThemePreference
  onThemePreference: (preference: ThemePreference) => void
}

/** 画出侧栏和内容区；窄窗口里侧栏变成可开合的抽屉。 */
export function MainWindow({
  screen,
  canGoBack,
  canGoForward,
  onNavigate,
  onBack,
  onForward,
  onOpenAuthorize,
  onLogout,
  theme,
  themePreference,
  onThemePreference,
}: MainWindowProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => window.matchMedia(narrowQuery).matches)
  const [lastWorkspace, setLastWorkspace] = useState<Screen>("chat")
  const [navigation, setNavigation] = useState<ProjectNavigationState>({ expandedProjects: {} })
  const [projects, setProjects] = useState(projectFixtures)
  const [addingProject, setAddingProject] = useState(false)
  const toast = useToast()
  const [poolState] = useState(createPoolState)
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
        onNewSession={() => onNavigate("chat-new")}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={() => onThemePreference(theme === "light" ? "dark" : "light")}
      />
      <AddProjectDialog
        open={addingProject}
        onOpenChange={setAddingProject}
        onAdd={(path) => {
          const next = addProject(projects, path)
          if (next === projects) {
            toast("这个文件夹已经在项目里", "info")
            return
          }
          setProjects(next)
          toast(`已添加项目 ${next[0]?.name ?? ""}`, "folder")
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
            sessionFixture={sessionFixture}
            onOpen={onNavigate}
          />
        ) : null}
        {screen === "onboarding" ? (
          <ScrollPanel>
            <OnboardingScreen
              onDone={() => onNavigate("chat-new")}
              onOpenAuthorize={onOpenAuthorize}
            />
          </ScrollPanel>
        ) : null}
        {screen === "tray" ? <TrayScreen onOpenAccounts={() => onNavigate("accounts")} /> : null}
        {screen === "accounts" ? (
          <ScrollPanel>
            <AccountsScreen
              accounts={poolState.accounts}
              proxies={poolState.proxies}
              onOpenAuthorize={onOpenAuthorize}
            />
          </ScrollPanel>
        ) : null}
        {screen === "proxies" ? (
          <ScrollPanel>
            <ProxiesScreen proxies={poolState.proxies} />
          </ScrollPanel>
        ) : null}
        {screen === "usage" ? (
          <ScrollPanel>
            <UsageScreen usageFixture={operationsUsageFixture} />
          </ScrollPanel>
        ) : null}
        {screen === "environment" ? (
          <ScrollPanel>
            <EnvironmentScreen fixture={operationsEnvironmentFixture} />
          </ScrollPanel>
        ) : null}
        {inSettings && !["accounts", "proxies", "usage", "environment"].includes(screen) ? (
          <SettingsScreen
            key={screen}
            screen={screen}
            themePreference={themePreference}
            onThemePreference={onThemePreference}
            onNavigate={onNavigate}
            onLogout={onLogout}
          />
        ) : null}
      </main>
    </div>
  )
}
