// 负责把设计稿里的页面串成可切换的桌面界面。
import { useEffect, useState } from "react"
import { Sidebar } from "./components/shell"
import { TooltipProvider } from "./components/ui/tooltip"
import { EnvironmentScreen } from "./screens/environment-screen"
import { UsageScreen } from "./screens/usage-screen"
import { AccountsScreen } from "./screens/accounts-screen"
import { ProxiesScreen } from "./screens/proxies-screen"
import { TrayScreen } from "./screens/tray-screen"
import { AuthorizeScreen } from "./screens/authorize-screen"
import { OnboardingScreen } from "./screens/onboarding-screen"
import { ChatScreen } from "./screens/chat-screen"
import { LoginScreen } from "./screens/login-screen"
import { SettingsScreen } from "./screens/settings/settings-sections"
import { sessionFixture } from "./fixtures/chat-fixtures"
import {
  operationsEnvironmentFixture,
  operationsUsageFixture,
} from "./fixtures/operations-fixtures"
import { createPoolState } from "./models/pool-model"
import { createAuthorizationState, reduceAuthorizationState } from "./models/authorization-model"
import { createLoginState, reduceLoginState } from "./models/login-model"
import type { ProjectNavigationState } from "./models/navigation-model"
import type { Screen } from "./screens/screen"

/** 按登录状态和当前页面画出整窗。 */
export function DesktopApp() {
  const [authed, setAuthed] = useState(false)
  const [loginState, setLoginState] = useState(createLoginState)
  const [authorizationState, setAuthorizationState] = useState(createAuthorizationState)
  const [screen, setScreen] = useState<Screen>("chat")
  const [theme, setTheme] = useState<"light" | "dark">("light")
  const [navigation, setNavigation] = useState<ProjectNavigationState>({
    expandedProjects: { frontend: true, "permission-api": true, cchelper: true },
  })
  const [poolState] = useState(createPoolState)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  if (!authed || screen === "login") {
    return (
      <LoginScreen
        state={loginState}
        onEvent={(event) => setLoginState((current) => reduceLoginState(current, event))}
        onSuccess={() => {
          setAuthed(true)
          setScreen("onboarding")
        }}
      />
    )
  }
  if (screen === "authorize") {
    return (
      <AuthorizeScreen
        state={authorizationState}
        onEvent={(event) =>
          setAuthorizationState((current) => reduceAuthorizationState(current, event))
        }
        onCancel={() => setScreen("accounts")}
      />
    )
  }

  const bare =
    screen === "onboarding" || screen === "tray" || screen === "chat" || screen === "chat-new"
  const settingsPage = [
    "profile",
    "switching",
    "general",
    "appearance",
    "session",
    "network",
    "data",
    "about",
  ].includes(screen)
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
            setLoginState(createLoginState())
            setScreen("login")
          }}
          theme={theme}
          onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
        />
        <main className="panel">
          {screen === "chat" || screen === "chat-new" ? (
            <ChatScreen
              fresh={screen === "chat-new"}
              sessionFixture={sessionFixture}
              onOpen={setScreen}
            />
          ) : null}
          {screen === "onboarding" ? (
            <OnboardingScreen
              onDone={() => setScreen("chat-new")}
              onOpenAuthorize={() => {
                setAuthorizationState(createAuthorizationState())
                setScreen("authorize")
              }}
            />
          ) : null}
          {screen === "tray" ? <TrayScreen onOpenAccounts={() => setScreen("accounts")} /> : null}
          {screen === "accounts" ? (
            <AccountsScreen
              accounts={poolState.accounts}
              proxies={poolState.proxies}
              onOpenAuthorize={() => {
                setAuthorizationState(createAuthorizationState())
                setScreen("authorize")
              }}
            />
          ) : null}
          {screen === "proxies" ? <ProxiesScreen proxies={poolState.proxies} /> : null}
          {screen === "usage" ? <UsageScreen usageFixture={operationsUsageFixture} /> : null}
          {screen === "environment" ? (
            <EnvironmentScreen fixture={operationsEnvironmentFixture} />
          ) : null}
          {bare || !settingsPage ? null : <SettingsScreen screen={screen} onNavigate={setScreen} />}
        </main>
      </div>
    </TooltipProvider>
  )
}
