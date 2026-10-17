// 负责把设计稿里的页面串成可切换的桌面界面，并承接主进程授权事件。
import { useEffect, useState } from "react"
import type { AuthorizationStateEvent } from "../../main/authorization/types"
import { AccountsScreen } from "./screens/accounts-screen"
import { AuthorizeScreen } from "./screens/authorize-screen"
import { ChatScreen } from "./screens/chat-screen"
import { EnvironmentScreen } from "./screens/environment-screen"
import { LoginScreen } from "./screens/login-screen"
import { OnboardingScreen } from "./screens/onboarding-screen"
import { ProxiesScreen } from "./screens/proxies-screen"
import { SettingsScreen } from "./screens/settings/settings-sections"
import { TrayScreen } from "./screens/tray-screen"
import { UsageScreen } from "./screens/usage-screen"
import { Sidebar } from "./components/shell"
import { TooltipProvider } from "./components/ui/tooltip"
import { sessionFixture } from "./fixtures/chat-fixtures"
import {
  operationsEnvironmentFixture,
  operationsUsageFixture,
} from "./fixtures/operations-fixtures"
import { createAuthorizationState, reduceAuthorizationState } from "./models/authorization-model"
import { createLoginState, reduceLoginState, type LoginIntent } from "./models/login-model"
import { createPoolState } from "./models/pool-model"
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

  useEffect(() => {
    const unsubscribe = window.pigclaude?.onAuthorizationState?.((event) => {
      if (event.purpose === "pigclaude-login") {
        const intent: LoginIntent = event.mode === "register" ? "register" : "login"
        const authorizationUrl = event.authorizationUrl
        const expiresAt = event.expiresAt
        const displayName = event.displayName
        if (event.status === "browser-open" && authorizationUrl && typeof expiresAt === "number") {
          setLoginState((current) =>
            reduceLoginState(current, {
              type: "started",
              intent,
              sessionId: event.sessionId,
              authorizationUrl,
              expiresAt,
            }),
          )
          return
        }
        if (event.status === "completed" && displayName && typeof expiresAt === "number") {
          setLoginState((current) =>
            reduceLoginState(current, {
              type: "completed",
              intent,
              sessionId: event.sessionId,
              displayName,
              expiresAt,
            }),
          )
          return
        }
        if (isAuthorizationFailure(event)) {
          setLoginState((current) =>
            reduceLoginState(current, {
              type: "failed",
              error: event.error ?? statusText(event.status),
            }),
          )
        }
        return
      }
      if (event.purpose === "claude-account") {
        if (event.status === "browser-open" && event.authorizationUrl) {
          setAuthorizationState((current) =>
            reduceAuthorizationState(current, {
              type: "start",
              sessionId: event.sessionId,
              url: event.authorizationUrl ?? "",
            }),
          )
          return
        }
        if (event.status === "completed") {
          setAuthorizationState((current) =>
            reduceAuthorizationState(current, { type: "approved" }),
          )
          return
        }
        if (isAuthorizationFailure(event)) {
          setAuthorizationState((current) =>
            reduceAuthorizationState(current, {
              type: "failed",
              error: event.error ?? statusText(event.status),
            }),
          )
        }
      }
    })
    return () => unsubscribe?.()
  }, [])

  async function startLoginAuthorization(intent: LoginIntent): Promise<void> {
    setLoginState((current) => reduceLoginState(current, { type: "start-request", intent }))
    const bridge = window.pigclaude
    if (!bridge?.startAuthorization) {
      setLoginState((current) =>
        reduceLoginState(current, { type: "failed", error: "桌面授权桥不可用" }),
      )
      return
    }
    try {
      const result = await bridge.startAuthorization({ purpose: "pigclaude-login", mode: intent })
      if (!result.ok) {
        setLoginState((current) =>
          reduceLoginState(current, { type: "failed", error: result.error }),
        )
        return
      }
      setLoginState((current) =>
        reduceLoginState(current, {
          type: "started",
          intent,
          sessionId: result.sessionId,
          authorizationUrl: result.authorizationUrl,
          expiresAt: result.expiresAt,
        }),
      )
    } catch (error: unknown) {
      setLoginState((current) =>
        reduceLoginState(current, { type: "failed", error: errorMessage(error) }),
      )
    }
  }

  async function cancelLoginAuthorization(): Promise<void> {
    const sessionId = loginState.sessionId
    if (sessionId) await window.pigclaude?.cancelAuthorization?.(sessionId)
    setLoginState((current) => reduceLoginState(current, { type: "cancelled" }))
  }

  async function startClaudeAuthorization(input: {
    accountName: string
    proxyId: string | null
    fingerprintSeed: string | null
    bridgeExit: string
    daemonExit: string
  }): Promise<void> {
    const bridge = window.pigclaude
    if (!bridge?.startAuthorization) {
      setAuthorizationState((current) =>
        reduceAuthorizationState(current, { type: "failed", error: "桌面授权桥不可用" }),
      )
      return
    }
    try {
      const result = await bridge.startAuthorization({
        purpose: "claude-account",
        mode: "authorize",
        accountName: input.accountName,
        proxyId: input.proxyId ?? undefined,
        fingerprintSeed: input.fingerprintSeed ?? undefined,
        bridgeExit: input.bridgeExit,
        daemonExit: input.daemonExit,
      })
      if (!result.ok) {
        setAuthorizationState((current) =>
          reduceAuthorizationState(current, { type: "failed", error: result.error }),
        )
        return
      }
      setAuthorizationState((current) =>
        reduceAuthorizationState(current, {
          type: "start",
          sessionId: result.sessionId,
          url: result.authorizationUrl,
        }),
      )
    } catch (error: unknown) {
      setAuthorizationState((current) =>
        reduceAuthorizationState(current, { type: "failed", error: errorMessage(error) }),
      )
    }
  }

  async function cancelClaudeAuthorization(): Promise<void> {
    const sessionId = authorizationState.sessionId
    if (sessionId) await window.pigclaude?.cancelAuthorization?.(sessionId)
    setAuthorizationState(createAuthorizationState())
    setScreen("accounts")
  }

  function logout(): void {
    setAuthed(false)
    setLoginState(createLoginState())
    setScreen("login")
  }

  if (!authed || screen === "login") {
    return (
      <LoginScreen
        state={loginState}
        onAuthorize={(intent) => void startLoginAuthorization(intent)}
        onCancel={() => void cancelLoginAuthorization()}
        onReset={() => setLoginState((current) => reduceLoginState(current, { type: "reset" }))}
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
        onStartBrowserAuthorization={(input) => void startClaudeAuthorization(input)}
        onCancel={() => void cancelClaudeAuthorization()}
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
          onLogout={logout}
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
          {bare || !settingsPage ? null : (
            <SettingsScreen screen={screen} onNavigate={setScreen} onLogout={logout} />
          )}
        </main>
      </div>
    </TooltipProvider>
  )
}

function isAuthorizationFailure(event: AuthorizationStateEvent): boolean {
  return [
    "cancelled",
    "denied",
    "expired",
    "state-mismatch",
    "proxy-mismatch",
    "network-error",
    "exchange-error",
  ].includes(event.status)
}

function statusText(status: AuthorizationStateEvent["status"]): string {
  const messages: Partial<Record<AuthorizationStateEvent["status"], string>> = {
    cancelled: "已取消授权",
    denied: "浏览器拒绝了授权",
    expired: "授权链接已过期",
    "state-mismatch": "授权回调校验失败",
    "proxy-mismatch": "登录出口不一致",
    "network-error": "授权服务不可用",
    "exchange-error": "授权码交换失败",
  }
  return messages[status] ?? "授权未完成"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "授权服务不可用"
}
