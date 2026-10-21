// 负责把设计稿里的页面串成可切换的桌面界面，并承接主进程授权事件。
import { useEffect, useRef, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { AuthorizationStateEvent } from "../../main/authorization/types"
import { AuthorizeScreen } from "./screens/authorize-screen"
import { LoginScreen } from "./screens/login-screen"
import { OnboardingScreen } from "./screens/onboarding-screen"
import { MainWindow } from "./main-window"
import { ToastProvider } from "./components/toast"
import { TooltipProvider } from "./components/ui/tooltip"
import { useAppearance } from "./hooks/use-appearance"
import { useMembershipConfirmation } from "./hooks/use-membership-confirmation"
import { markOnboardingSeen } from "./lib/onboarding-storage"
import { createAuthorizationState, reduceAuthorizationState } from "./models/authorization-model"
import { parseDevView } from "./models/dev-view"
import { createLoginState, reduceLoginState, type LoginIntent } from "./models/login-model"
import {
  initialMembershipView,
  membershipGateMessage,
  newerMembershipView,
} from "./models/membership-view"
import { initialScreenAfterLogin } from "./models/onboarding-gate"
import type { OnboardingStep } from "./models/onboarding-model"
import {
  canGoBack,
  canGoForward,
  createScreenHistory,
  currentScreen,
  goBack,
  goForward,
  pushScreen,
} from "./models/screen-history"
import type { Screen } from "./screens/screen"

/** 按登录状态和当前页面画出整窗。 */
export function DesktopApp() {
  const [devView] = useState(() => parseDevView(window.location.search, import.meta.env.DEV))
  const [membership, setMembership] = useState<MembershipView>(initialMembershipView)
  const [loginState, setLoginState] = useState(createLoginState)
  const [authorizationState, setAuthorizationState] = useState(createAuthorizationState)
  const [history, setHistory] = useState(() => createScreenHistory(devView?.screen ?? "login"))
  const screen = currentScreen(history)
  const appearance = useAppearance()
  const [onboardingReturn, setOnboardingReturn] = useState<OnboardingStep | undefined>()
  const [signOutState, setSignOutState] = useState({ pending: false, error: null as string | null })
  const signOutInFlight = useRef(false)
  const authorizationGeneration = useRef(0)
  const authorizationSession = useRef<string | null>(null)
  const acceptAuthorizationEvents = useRef(true)
  const browserPreview = devView !== null && !window.pigclaude?.membership
  const canUseDesktop =
    !signOutState.pending &&
    signOutState.error === null &&
    (browserPreview || membership.state === "active")
  const confirmMembership = useMembershipConfirmation({
    confirming: loginState.view === "confirming",
    membership,
    onInspected: (view) => setMembership((current) => newerMembershipView(current, view)),
    onInactive: () => setLoginState((current) => reduceLoginState(current, { type: "reset" })),
  })

  useEffect(() => {
    const bridge = window.pigclaude?.membership
    if (!bridge) return
    const unsubscribe = bridge.subscribe((view) =>
      setMembership((current) => newerMembershipView(current, view)),
    )
    void bridge.inspect().then((view) => {
      if (view) setMembership((current) => newerMembershipView(current, view))
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (membership.startupPhase === "checking") return
    if (canUseDesktop && screen === "login") {
      const next = browserPreview ? "onboarding" : initialScreenAfterLogin(membership)
      setHistory(createScreenHistory(next))
    } else if (!canUseDesktop && screen !== "login") {
      setHistory((current) => pushScreen(current, "login"))
    }
  }, [browserPreview, canUseDesktop, membership, screen])

  function setScreen(next: Screen): void {
    setHistory((current) => pushScreen(current, next))
  }

  function openAuthorize(returnStep?: OnboardingStep): void {
    setAuthorizationState(createAuthorizationState())
    setOnboardingReturn(returnStep)
    setScreen("authorize")
  }

  function finishOnboarding(): void {
    const userId = membership.account?.userId
    if (userId) markOnboardingSeen(userId)
    setOnboardingReturn(undefined)
    setHistory(createScreenHistory("chat"))
  }

  useEffect(() => {
    const subscribeAuthorization =
      window.pigclaude?.authorization?.subscribe ?? window.pigclaude?.onAuthorizationState
    const unsubscribe = subscribeAuthorization?.((event) => {
      if (!acceptAuthorizationEvents.current) return
      if (event.status === "browser-open") {
        if (authorizationSession.current && authorizationSession.current !== event.sessionId) return
        authorizationSession.current = event.sessionId
      } else if (!event.sessionId || authorizationSession.current !== event.sessionId) return
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
          confirmMembership()
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
  }, [confirmMembership])

  async function startLoginAuthorization(intent: LoginIntent): Promise<void> {
    if (signOutState.pending || signOutState.error) return
    const generation = ++authorizationGeneration.current
    authorizationSession.current = null
    acceptAuthorizationEvents.current = true
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
      if (generation !== authorizationGeneration.current) return
      if (!result.ok) {
        setLoginState((current) =>
          reduceLoginState(current, { type: "failed", error: result.error }),
        )
        return
      }
      authorizationSession.current = result.sessionId
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
      if (generation !== authorizationGeneration.current) return
      setLoginState((current) =>
        reduceLoginState(current, { type: "failed", error: errorMessage(error) }),
      )
    }
  }

  async function cancelLoginAuthorization(): Promise<void> {
    authorizationGeneration.current++
    authorizationSession.current = null
    acceptAuthorizationEvents.current = false
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
    const generation = ++authorizationGeneration.current
    authorizationSession.current = null
    acceptAuthorizationEvents.current = true
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
      if (generation !== authorizationGeneration.current) return
      if (!result.ok) {
        setAuthorizationState((current) =>
          reduceAuthorizationState(current, { type: "failed", error: result.error }),
        )
        return
      }
      authorizationSession.current = result.sessionId
      setAuthorizationState((current) =>
        reduceAuthorizationState(current, {
          type: "start",
          sessionId: result.sessionId,
          url: result.authorizationUrl,
        }),
      )
    } catch (error: unknown) {
      if (generation !== authorizationGeneration.current) return
      setAuthorizationState((current) =>
        reduceAuthorizationState(current, { type: "failed", error: errorMessage(error) }),
      )
    }
  }

  async function cancelClaudeAuthorization(): Promise<void> {
    authorizationGeneration.current++
    authorizationSession.current = null
    acceptAuthorizationEvents.current = false
    const sessionId = authorizationState.sessionId
    const cancelAuthorization =
      window.pigclaude?.authorization?.cancel ?? window.pigclaude?.cancelAuthorization
    if (sessionId) await cancelAuthorization?.(sessionId)
    setAuthorizationState(createAuthorizationState())
    setHistory((current) =>
      canGoBack(current) ? goBack(current) : pushScreen(current, "accounts"),
    )
  }

  async function logout(): Promise<void> {
    if (signOutInFlight.current) return
    signOutInFlight.current = true
    authorizationGeneration.current++
    authorizationSession.current = null
    acceptAuthorizationEvents.current = false
    setSignOutState({ pending: true, error: null })
    setLoginState(createLoginState())
    setAuthorizationState(createAuthorizationState())
    setOnboardingReturn(undefined)
    setHistory(createScreenHistory("login"))
    try {
      if (!browserPreview) {
        const signOut = window.pigclaude?.membership?.signOut
        if (!signOut) throw new Error("桌面退出服务不可用")
        const view = await signOut()
        if (view.state !== "signed_out") throw new Error("本机授权材料未完成清理")
        setMembership((current) => newerMembershipView(current, view))
      }
      setSignOutState({ pending: false, error: null })
    } catch (error: unknown) {
      setSignOutState({ pending: false, error: `退出登录失败：${errorMessage(error)}` })
    } finally {
      signOutInFlight.current = false
    }
  }

  if (!canUseDesktop || screen === "login") {
    return (
      <LoginScreen
        state={loginState}
        gateMessage={
          signOutState.error ??
          (signOutState.pending ? "正在退出登录…" : membershipGateMessage(membership))
        }
        signingOut={signOutState.pending}
        canWithdraw={membership.account !== null && membership.state !== "device_revoked"}
        onRetrySignOut={signOutState.error ? () => void logout() : undefined}
        onAuthorize={(intent) => void startLoginAuthorization(intent)}
        onCancel={() => void cancelLoginAuthorization()}
        onReset={() => setLoginState((current) => reduceLoginState(current, { type: "reset" }))}
      />
    )
  }
  if (screen === "onboarding") {
    return (
      <OnboardingScreen
        key={onboardingReturn ?? "start"}
        onFinish={finishOnboarding}
        onOpenAuthorize={() => openAuthorize("account")}
        returnStep={onboardingReturn}
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
          onOpenAuthorize={() => openAuthorize()}
          onLogout={() => void logout()}
          theme={appearance.resolved}
          appearance={appearance}
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
