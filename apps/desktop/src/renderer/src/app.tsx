// 负责把设计稿里的页面串成可切换的桌面界面，并承接主进程授权事件。
import { useEffect, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { AuthorizationStateEvent } from "../../main/authorization/types"
import { AuthorizeScreen } from "./screens/authorize-screen"
import { LoginScreen } from "./screens/login-screen"
import { MainWindow } from "./main-window"
import { ToastProvider } from "./components/toast"
import { TooltipProvider } from "./components/ui/tooltip"
import { createAuthorizationState, reduceAuthorizationState } from "./models/authorization-model"
import { createLoginState, reduceLoginState, type LoginIntent } from "./models/login-model"
import {
  canGoBack,
  canGoForward,
  createScreenHistory,
  currentScreen,
  goBack,
  goForward,
  pushScreen,
} from "./models/screen-history"
import { parseThemePreference, resolveTheme, type ThemePreference } from "./models/theme-model"
import type { Screen } from "./screens/screen"

const themeStorageKey = "pigclaude-theme"
const darkQuery = "(prefers-color-scheme: dark)"

/** 按登录状态和当前页面画出整窗。 */
export function DesktopApp() {
  const [membership, setMembership] = useState<MembershipView>(initialMembershipView)
  const [loginState, setLoginState] = useState(createLoginState)
  const [authorizationState, setAuthorizationState] = useState(createAuthorizationState)
  const [history, setHistory] = useState(() => createScreenHistory("chat"))
  const screen = currentScreen(history)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    parseThemePreference(window.localStorage.getItem(themeStorageKey)),
  )
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(darkQuery).matches)
  const theme = resolveTheme(themePreference, systemDark)
  const canUseDesktop = membership.state === "active" || membership.state === "offline_grace"

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void window.pigclaude?.setTheme?.(themePreference)
  }, [themePreference])

  useEffect(() => {
    const query = window.matchMedia(darkQuery)
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    const bridge = window.pigclaude?.membership
    if (!bridge) return
    const unsubscribe = bridge.subscribe((view) => setMembership(view))
    void bridge.inspect().then((view) => {
      if (view) setMembership(view)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (membership.startupPhase === "checking") return
    if (canUseDesktop && screen === "login") {
      setHistory((current) => pushScreen(current, "onboarding"))
    } else if (!canUseDesktop && screen !== "login") {
      setHistory((current) => pushScreen(current, "login"))
    }
  }, [canUseDesktop, membership.startupPhase, screen])

  function setScreen(next: Screen): void {
    setHistory((current) => pushScreen(current, next))
  }

  function changeThemePreference(preference: ThemePreference): void {
    setThemePreference(preference)
    window.localStorage.setItem(themeStorageKey, preference)
  }

  useEffect(() => {
    const subscribeAuthorization =
      window.pigclaude?.authorization?.subscribe ?? window.pigclaude?.onAuthorizationState
    const unsubscribe = subscribeAuthorization?.((event) => {
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
    const startAuthorization = bridge?.authorization?.start ?? bridge?.startAuthorization
    if (!startAuthorization) {
      setLoginState((current) =>
        reduceLoginState(current, { type: "failed", error: "桌面授权桥不可用" }),
      )
      return
    }
    try {
      const result = await startAuthorization({ purpose: "pigclaude-login", mode: intent })
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
    const cancelAuthorization =
      window.pigclaude?.authorization?.cancel ?? window.pigclaude?.cancelAuthorization
    if (sessionId) await cancelAuthorization?.(sessionId)
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
    const startAuthorization = bridge?.authorization?.start ?? bridge?.startAuthorization
    if (!startAuthorization) {
      setAuthorizationState((current) =>
        reduceAuthorizationState(current, { type: "failed", error: "桌面授权桥不可用" }),
      )
      return
    }
    try {
      const result = await startAuthorization({
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
    const cancelAuthorization =
      window.pigclaude?.authorization?.cancel ?? window.pigclaude?.cancelAuthorization
    if (sessionId) await cancelAuthorization?.(sessionId)
    setAuthorizationState(createAuthorizationState())
    setHistory((current) =>
      canGoBack(current) ? goBack(current) : pushScreen(current, "accounts"),
    )
  }

  function logout(): void {
    setLoginState(createLoginState())
    setHistory(createScreenHistory("login"))
  }

  if (!canUseDesktop || screen === "login") {
    return (
      <LoginScreen
        state={loginState}
        gateMessage={membershipGateMessage(membership)}
        onAuthorize={(intent) => void startLoginAuthorization(intent)}
        onCancel={() => void cancelLoginAuthorization()}
        onReset={() => setLoginState((current) => reduceLoginState(current, { type: "reset" }))}
        onSuccess={() => {
          if (canUseDesktop) setHistory(createScreenHistory("onboarding"))
          else void window.pigclaude?.membership?.inspect()
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

  return (
    <TooltipProvider>
      <ToastProvider>
        <MainWindow
          screen={screen}
          canGoBack={canGoBack(history)}
          canGoForward={canGoForward(history)}
          onNavigate={setScreen}
          onBack={() => setHistory(goBack)}
          onForward={() => setHistory(goForward)}
          onOpenAuthorize={() => {
            setAuthorizationState(createAuthorizationState())
            setScreen("authorize")
          }}
          onLogout={logout}
          theme={theme}
          themePreference={themePreference}
          onThemePreference={changeThemePreference}
        />
      </ToastProvider>
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

function initialMembershipView(): MembershipView {
  return {
    startupPhase: "checking",
    revision: 0,
    state: "connecting",
    account: null,
    productCode: null,
    planKind: null,
    lifetime: false,
    membershipValidUntil: null,
    offlineValidUntil: null,
    lastVerifiedAt: null,
    nextVerificationAt: null,
    bindingEpoch: null,
    errorCode: null,
    serverReason: null,
    authorizationUrl: null,
  }
}

function membershipGateMessage(view: MembershipView): string | undefined {
  const messages: Partial<Record<MembershipView["state"], string>> = {
    connecting: "正在连接 Rust 授权服务…",
    configuration_error: "桌面授权配置无效，请检查本地服务地址。",
    signed_out: "请先在浏览器中登录并授权这台设备。",
    verification_required: "当前账户没有可用会员授权，请完成浏览器授权后重试。",
    expired: "会员已到期，请续期后重新检查。",
    device_revoked: "这台设备已被撤销，请重新授权当前设备。",
    error: "暂时无法验证会员状态，请检查 Rust 服务是否运行。",
  }
  return messages[view.state]
}
