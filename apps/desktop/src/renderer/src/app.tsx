// 负责把设计稿里的页面串成可切换的桌面界面，并承接主进程授权事件。
import { useEffect, useRef, useState } from "react"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { AuthorizationStateEvent } from "../../main/authorization/types"
import { AuthorizeScreen } from "./screens/authorize-screen"
import { DesktopEntryScreen } from "./screens/desktop-entry-screen"
import { OnboardingScreen } from "./screens/onboarding-screen"
import { MainWindow } from "./main-window"
import { ToastProvider } from "./components/toast"
import { TooltipProvider } from "./components/ui/tooltip"
import { useAppearance } from "./hooks/use-appearance"
import { useClaudeAccounts } from "./hooks/use-claude-accounts"
import { useMembershipConfirmation } from "./hooks/use-membership-confirmation"
import { markOnboardingSeen } from "./lib/onboarding-storage"
import {
  applyClaudeAccountEvent,
  createAuthorizationState,
  reduceAuthorizationState,
} from "./models/authorization-model"
import { toPoolProxy } from "./models/claude-account-view"
import { parseDevView, type DevLoginPhase, type DevView } from "./models/dev-view"
import {
  acceptLoginStartResult,
  createLoginState,
  reduceLoginState,
  type LoginIntent,
  type LoginState,
} from "./models/login-model"
import {
  initialMembershipView,
  membershipGateMessage,
  newerMembershipView,
} from "./models/membership-view"
import { initialScreenAfterLogin } from "./models/onboarding-gate"
import {
  createOnboardingState,
  resumeOnboarding,
  type OnboardingState,
} from "./models/onboarding-model"
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
  const [loginState, setLoginState] = useState(() => devLoginState(devView?.phase))
  const [authorizationState, setAuthorizationState] = useState(createAuthorizationState)
  const [history, setHistory] = useState(() => createScreenHistory(devView?.screen ?? "login"))
  const screen = currentScreen(history)
  const appearance = useAppearance()
  const claudeAccounts = useClaudeAccounts()
  const [reauthorizeAccountId, setReauthorizeAccountId] = useState<string | null>(null)
  // 引导进度放在这里而不是引导页内部，打开 Claude 授权页再回来时进度不会丢。
  const [onboardingReturn, setOnboardingReturn] = useState<OnboardingState | undefined>(() =>
    devView?.step ? createOnboardingState(devView.step) : undefined,
  )
  const [signOutState, setSignOutState] = useState({ pending: false, error: null as string | null })
  const signOutInFlight = useRef(false)
  const authorizationGeneration = useRef(0)
  const authorizationSession = useRef<string | null>(null)
  const authorizationRequest = useRef<string | null>(null)
  const acceptAuthorizationEvents = useRef(true)
  const restartingClaude = useRef(false)
  const skipRestartCancellation = useRef(false)
  const browserPreview = devView !== null && !window.pigclaude?.membership
  const canUseDesktop =
    (loginState.view === "idle" || loginState.view === "confirming") &&
    !signOutState.pending &&
    signOutState.error === null &&
    (browserPreview ? devView?.phase === undefined : membership.state === "active")
  const startupSettled = membership.startupPhase !== "checking"
  const gatedScreen: Screen | null =
    canUseDesktop && screen === "login" && startupSettled
      ? browserPreview
        ? "onboarding"
        : initialScreenAfterLogin(membership)
      : null
  const shownScreen = gatedScreen ?? screen
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
    const event = claudeAccounts.event
    if (event === null) return
    if (event.phase === "cancelled" && skipRestartCancellation.current) {
      skipRestartCancellation.current = false
      return
    }
    if (event.phase === "waiting-browser") skipRestartCancellation.current = false
    setAuthorizationState((current) => applyClaudeAccountEvent(current, event))
  }, [claudeAccounts.event])

  useEffect(() => {
    if (claudeAccounts.error === null) return
    setAuthorizationState((current) => ({ ...current, error: claudeAccounts.error }))
  }, [claudeAccounts.error])

  // 渲染时已经直接画出 gatedScreen，这里只把历史记录补成同一屏，中间不会先画登录页。
  useEffect(() => {
    if (!startupSettled) return
    if (gatedScreen) {
      setHistory(createScreenHistory(gatedScreen))
    } else if (!canUseDesktop && screen !== "login") {
      setHistory((current) => pushScreen(current, "login"))
    }
  }, [canUseDesktop, gatedScreen, screen, startupSettled])

  function setScreen(next: Screen): void {
    setHistory((current) => pushScreen(current, next))
  }

  function openAuthorize(returnTo?: OnboardingState, accountId?: string | null): void {
    setReauthorizeAccountId(accountId ?? null)
    setAuthorizationState(createAuthorizationState())
    setOnboardingReturn(returnTo)
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
        const intent: LoginIntent =
          event.mode === "register" ? "register" : event.mode === "switch" ? "switch" : "login"
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
          acceptAuthorizationEvents.current = false
          authorizationSession.current = null
          authorizationRequest.current = null
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
        if (event.status === "committing") {
          setLoginState((current) => reduceLoginState(current, { type: "committing" }))
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
    const clientRequestId = crypto.randomUUID()
    authorizationRequest.current = clientRequestId
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
      const result = await startAuthorization({
        purpose: "pigclaude-login",
        mode: intent,
        clientRequestId,
      })
      if (generation !== authorizationGeneration.current) return
      if (result.ok) authorizationSession.current = result.sessionId
      setLoginState((current) => acceptLoginStartResult(current, intent, result))
    } catch (error: unknown) {
      if (generation !== authorizationGeneration.current) return
      setLoginState((current) =>
        acceptLoginStartResult(current, intent, {
          ok: false,
          status: "network-error",
          error: errorMessage(error),
        }),
      )
    }
  }

  async function cancelLoginAuthorization(): Promise<void> {
    const generation = authorizationGeneration.current
    const sessionId = loginState.sessionId
    const requestId = sessionId ?? authorizationRequest.current
    const cancelAuthorization =
      window.pigclaude?.authorization?.cancel ?? window.pigclaude?.cancelAuthorization
    const result = requestId ? await cancelAuthorization?.(requestId) : undefined
    if (generation !== authorizationGeneration.current || !acceptAuthorizationEvents.current) return
    if (result?.status === "committing") {
      setLoginState((current) =>
        current.view === "waiting" || current.view === "starting"
          ? reduceLoginState(current, { type: "committing" })
          : current,
      )
      return
    }
    if (result?.sessionId && sessionId && result.sessionId !== sessionId) return
    authorizationGeneration.current++
    authorizationRequest.current = null
    authorizationSession.current = null
    acceptAuthorizationEvents.current = false
    setLoginState((current) => reduceLoginState(current, { type: "cancelled" }))
  }

  function startClaudeAuthorization(input: {
    accountId?: string
    displayName: string
    proxyId: string | null
    fingerprint: ClaudeFingerprintView
  }): void {
    const start = () => {
      acceptAuthorizationEvents.current = true
      authorizationSession.current = null
      setAuthorizationState((current) => ({ ...current, step: "exit", error: null }))
      void claudeAccounts.authorize(input)
    }
    if (authorizationState.step !== "waiting") return start()
    if (restartingClaude.current) return
    restartingClaude.current = true
    skipRestartCancellation.current = true
    void claudeAccounts.cancelAuthorization().then((cancelled) => {
      if (!restartingClaude.current) return
      restartingClaude.current = false
      if (cancelled) start()
      else skipRestartCancellation.current = false
    })
  }

  async function cancelClaudeAuthorization(): Promise<void> {
    restartingClaude.current = false
    skipRestartCancellation.current = false
    if (!(await claudeAccounts.cancelAuthorization())) return
    authorizationGeneration.current++
    authorizationSession.current = null
    acceptAuthorizationEvents.current = false
    // 授权已完成时回到引导的下一步并记下这一步已完成；中途取消则回到原步骤。
    const authorized = authorizationState.approved || authorizationState.step === "completed"
    setOnboardingReturn((current) => current && resumeOnboarding(current, authorized))
    setAuthorizationState(createAuthorizationState())
    setReauthorizeAccountId(null)
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

  if (!canUseDesktop || shownScreen === "login") {
    return (
      <DesktopEntryScreen
        membership={membership}
        preview={browserPreview}
        onMembership={(view) => setMembership((current) => newerMembershipView(current, view))}
        state={loginState}
        gateMessage={
          signOutState.error ??
          (signOutState.pending
            ? "正在退出登录…"
            : previewGateMessage(browserPreview, devView, membership))
        }
        signingOut={signOutState.pending}
        canWithdraw={membership.account !== null && membership.state !== "device_revoked"}
        onRetrySignOut={signOutState.error ? () => void logout() : undefined}
        onAuthorize={(intent) => void startLoginAuthorization(intent)}
        onCancel={() => void cancelLoginAuthorization()}
        onReset={() => void cancelLoginAuthorization()}
      />
    )
  }
  if (shownScreen === "onboarding") {
    return (
      <OnboardingScreen
        key={onboardingReturn?.step ?? "start"}
        onFinish={finishOnboarding}
        onOpenAuthorize={openAuthorize}
        resume={onboardingReturn}
      />
    )
  }
  if (shownScreen === "authorize") {
    return (
      <AuthorizeScreen
        state={authorizationState}
        proxies={claudeAccounts.proxies.map((proxy) => toPoolProxy(proxy, claudeAccounts.accounts))}
        account={claudeAccounts.accounts.find((item) => item.id === reauthorizeAccountId) ?? null}
        onEvent={(event) =>
          setAuthorizationState((current) => reduceAuthorizationState(current, event))
        }
        onStartBrowserAuthorization={startClaudeAuthorization}
        onCancel={() => void cancelClaudeAuthorization()}
      />
    )
  }

  return (
    <TooltipProvider>
      <ToastProvider>
        <MainWindow
          screen={shownScreen}
          canGoBack={canGoBack(history)}
          canGoForward={canGoForward(history)}
          membership={membership}
          claudeAccounts={claudeAccounts}
          onNavigate={setScreen}
          onBack={() => setHistory(goBack)}
          onForward={() => setHistory(goForward)}
          onOpenAuthorize={() => openAuthorize()}
          onReauthorizeAccount={(accountId) => openAuthorize(undefined, accountId)}
          onLogout={() => void logout()}
          theme={appearance.resolved}
          appearance={appearance}
        />
      </ToastProvider>
    </TooltipProvider>
  )
}

// 开发期 phase 预览没有会员桥，不显示「正在连接」占位提示，让截图停在干净的登录页。
function previewGateMessage(
  browserPreview: boolean,
  devView: DevView | null,
  membership: MembershipView,
): string | undefined {
  if (browserPreview && devView?.phase !== undefined) return undefined
  return membershipGateMessage(membership)
}

// 开发期预览用的固定登录状态；时间戳取远期常量，保证截图不随时间变化。
function devLoginState(phase: DevLoginPhase | undefined): LoginState {
  const idle = createLoginState()
  if (phase === "waiting") {
    return {
      ...idle,
      view: "waiting",
      intent: "login",
      sessionId: "dev-preview",
      authorizationUrl: "https://pigclaude.example/oauth2/authorize",
      expiresAt: 4_102_444_800_000,
    }
  }
  if (phase === "confirming") {
    return { ...idle, view: "confirming", intent: "login", displayName: "小猪" }
  }
  if (phase === "error") return { ...idle, view: "error", error: "授权已过期，请重新授权。" }
  return idle
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
