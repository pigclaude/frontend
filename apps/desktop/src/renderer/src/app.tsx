// 负责把设计稿里的页面串成可切换的桌面界面。
import { useEffect, useState } from "react"
import { Sidebar } from "./components/shell"
import { TooltipProvider } from "./components/ui/tooltip"
import {
  AccountsScreen,
  EnvironmentScreen,
  ProxiesScreen,
  UsageScreen,
} from "./screens/pool-screens"
import { AuthorizeScreen, OnboardingScreen, TrayScreen } from "./screens/extra-screens"
import { ChatScreen } from "./screens/chat-screen"
import { LoginScreen } from "./screens/login-screen"
import { SettingsScreen } from "./screens/settings-screen"
import type { ProjectNavigationState } from "./models/navigation-model"
import type { Screen } from "./screens/screen"

/** 按登录状态和当前页面画出整窗。 */
export function DesktopApp() {
  const [authed, setAuthed] = useState(false)
  const [screen, setScreen] = useState<Screen>("chat")
  const [theme, setTheme] = useState<"light" | "dark">("light")
  const [navigation, setNavigation] = useState<ProjectNavigationState>({
    expandedProjects: { frontend: true, "permission-api": true, cchelper: true },
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  if (!authed || screen === "login") {
    return (
      <LoginScreen
        onEnter={() => {
          setAuthed(true)
          setScreen("onboarding")
        }}
      />
    )
  }
  if (screen === "authorize") {
    return <AuthorizeScreen onCancel={() => setScreen("accounts")} />
  }

  const bare =
    screen === "onboarding" || screen === "tray" || screen === "chat" || screen === "chat-new"
  return (
    <TooltipProvider>
      <div className="app">
        <Sidebar
          screen={screen}
          navigation={navigation}
          onNavigate={setScreen}
          onToggleProject={(projectId, expanded) =>
            setNavigation((current) => ({
              expandedProjects: { ...current.expandedProjects, [projectId]: expanded },
            }))
          }
          onNewSession={() => setScreen("chat-new")}
          onLogout={() => {
            setAuthed(false)
            setScreen("login")
          }}
          theme={theme}
          onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
        />
        <main className="panel">
          {screen === "chat" || screen === "chat-new" ? (
            <ChatScreen fresh={screen === "chat-new"} onOpen={setScreen} />
          ) : null}
          {screen === "onboarding" ? (
            <OnboardingScreen onDone={() => setScreen("chat-new")} />
          ) : null}
          {screen === "tray" ? <TrayScreen onOpenAccounts={() => setScreen("accounts")} /> : null}
          {screen === "accounts" ? <AccountsScreen onNavigate={setScreen} /> : null}
          {screen === "proxies" ? <ProxiesScreen /> : null}
          {screen === "usage" ? <UsageScreen /> : null}
          {screen === "environment" ? <EnvironmentScreen /> : null}
          {bare ? null : <SettingsScreen screen={screen} onNavigate={setScreen} />}
        </main>
      </div>
    </TooltipProvider>
  )
}
