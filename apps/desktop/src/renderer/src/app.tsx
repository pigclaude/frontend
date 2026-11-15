// 负责把设计稿里的页面串成可切换的桌面界面，并承接主进程授权事件。
import { useEffect, useRef, useState } from "react"
import { desktopText } from "./locale/text"
import { keepsMembershipRuntime, type MembershipView } from "@pigclaude/contracts/membership"
import { AuthorizeScreen } from "./screens/authorize-screen"
import { DesktopEntryScreen } from "./screens/desktop-entry-screen"
import { OnboardingScreen } from "./screens/onboarding-screen"
import { MainWindow } from "./main-window"
import { AppProviders } from "./app-providers"
import { useAppearance } from "./hooks/use-appearance"
import { useClaudeAccounts } from "./hooks/use-claude-accounts"
import { useBrowserProfiles } from "./hooks/use-browser-profiles"
import type { AuthorizeClaudeAccountInput } from "../../main/claude/account-service-inputs"
import { useMembershipConfirmation } from "./hooks/use-membership-confirmation"
import { useProjectDrafts } from "./hooks/use-project-draft"
import { markOnboardingSeen } from "./lib/onboarding-storage"
import {
  applyClaudeAccountEvent,
  createAuthorizationState,
  reduceAuthorizationState,
} from "./models/authorization-model"
import {
  authorizationErrorMessage,
  authorizationStatusText,
  isAuthorizationFailure,
} from "./models/authorization-status"
import { createPreviewWorkbench } from "./fixtures/preview-workbench"
import { toPoolProxy } from "./models/claude-account-view"
import { parseDevView, devLoginState, screenOfLocation, type DevView } from "./models/dev-view"
import {
  acceptLoginStartResult,
  createLoginState,
  reduceLoginState,
  type LoginIntent,
} from "./models/login-model"
import {
  initialMembershipView,
  membershipGateMessage,
  newerMembershipView,
} from "./models/membership-view"
import { initialLocationAfterLogin } from "./models/onboarding-gate"
import {
  createOnboardingState,
  resumeOnboarding,
  type OnboardingState,
} from "./models/onboarding-model"
import {
  canGoBack,
  canGoForward,
  createHistory,
  currentLocation,
  goBack,
  goForward,
  pushLocation,
  replaceDeletedSessionLocations,
  type FlowName,
  type NavLocation,
} from "./models/navigation"

const login: NavLocation = { kind: "flow", flow: "login" }

function isFlow(location: NavLocation, flow: FlowName): boolean {
  return location.kind === "flow" && location.flow === flow
}

/** 整窗：外面套上语言、提示与扩展点注册表，里面按登录状态和当前位置画。 */
export function DesktopApp() {
  return (
    <AppProviders>
      <DesktopGate />
    </AppProviders>
  )
}

/** 按登录状态和当前位置画出整窗。 */
function DesktopGate() {
  const [devView] = useState(() => parseDevView(window.location.search, import.meta.env.DEV))
  const [previewWorkbench] = useState(() =>
    devView?.workbench && !window.pigclaude ? createPreviewWorkbench() : undefined,
  )
  const [membership, setMembership] = useState<MembershipView>(initialMembershipView)
  const [loginState, setLoginState] = useState(() => devLoginState(devView?.phase))
  const [authorizationState, setAuthorizationState] = useState(createAuthorizationState)
  const [history, setHistory] = useState(() => createHistory(devView?.location ?? login))
  const location = currentLocation(history) ?? login
  const appearance = useAppearance()
  const claudeAccounts = useClaudeAccounts()
  const browserProfiles = useBrowserProfiles(
    claudeAccounts.refresh,
    membership.state === "active" || !window.pigclaude,
  )
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
  const drafts = useProjectDrafts(membership, browserPreview)
  const canUseDesktop =
    (loginState.view === "idle" || loginState.view === "confirming") &&
    !signOutState.pending &&
    signOutState.error === null &&
    (browserPreview ? devView?.phase === undefined : keepsMembershipRuntime(membership.state))
  const startupSettled = membership.startupPhase !== "checking"
  const gatedLocation: NavLocation | null =
    canUseDesktop && isFlow(location, "login") && startupSettled
      ? browserPreview
        ? { kind: "flow", flow: "onboarding" }
        : initialLocationAfterLogin(membership)
      : null
  const gatedKey = gatedLocation ? screenOfLocation(gatedLocation) : null
  const shown = gatedLocation ?? location
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

  // 渲染时已经直接画出 gatedLocation，这里只把历史记录补成同一个位置，中间不会先画登录页。
  const onLogin = isFlow(location, "login")
  useEffect(() => {
    if (!startupSettled) return
    if (gatedLocation) {
      setHistory(createHistory(gatedLocation))
    } else if (!canUseDesktop && !onLogin) {
      setHistory((current) => pushLocation(current, login))
    }
    // gatedLocation 每次渲染都是新对象，用 gatedKey 判断它是否变化。
  }, [canUseDesktop, gatedKey, onLogin, startupSettled])

  function navigate(next: NavLocation): void {
    setHistory((current) => pushLocation(current, next))
  }

  function openAuthorize(returnTo?: OnboardingState, accountId?: string | null): void {
    setReauthorizeAccountId(accountId ?? null)
    setAuthorizationState(createAuthorizationState())
    setOnboardingReturn(returnTo)
    navigate({ kind: "flow", flow: "authorize" })
  }

  function finishOnboarding(): void {
    const userId = membership.account?.userId
    if (userId) markOnboardingSeen(userId)
    setOnboardingReturn(undefined)
    setHistory(createHistory({ kind: "session" }))
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
              error: event.error ?? authorizationStatusText(event.status),
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
              error: event.error ?? authorizationStatusText(event.status),
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
        reduceLoginState(current, {
          type: "failed",
          error: desktopText("flows.app.bridgeUnavailable"),
        }),
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
          error: authorizationErrorMessage(error),
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

  function startClaudeAuthorization(input: AuthorizeClaudeAccountInput): void {
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
      canGoBack(current)
        ? goBack(current)
        : pushLocation(current, { kind: "settings", page: "accounts" }),
    )
  }

  async function logout(): Promise<void> {
    if (signOutInFlight.current) return
    signOutInFlight.current = true
    drafts.clear()
    authorizationGeneration.current++
    authorizationSession.current = null
    acceptAuthorizationEvents.current = false
    setSignOutState({ pending: true, error: null })
    setLoginState(createLoginState())
    setAuthorizationState(createAuthorizationState())
    setOnboardingReturn(undefined)
    setHistory(createHistory(login))
    try {
      if (!browserPreview) {
        const signOut = window.pigclaude?.membership?.signOut
        if (!signOut) throw new Error(desktopText("flows.app.signOutUnavailable"))
        const view = await signOut()
        if (view.state !== "signed_out") throw new Error(desktopText("flows.app.signOutIncomplete"))
        setMembership((current) => newerMembershipView(current, view))
      }
      setSignOutState({ pending: false, error: null })
    } catch (error: unknown) {
      setSignOutState({
        pending: false,
        error: desktopText("flows.app.signOutError", { error: authorizationErrorMessage(error) }),
      })
    } finally {
      signOutInFlight.current = false
    }
  }

  if (!canUseDesktop || isFlow(shown, "login")) {
    return (
      <DesktopEntryScreen
        membership={membership}
        preview={browserPreview}
        onMembership={(view) => setMembership((current) => newerMembershipView(current, view))}
        state={loginState}
        gateMessage={
          signOutState.error ??
          (signOutState.pending
            ? desktopText("flows.app.signingOut")
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
  if (isFlow(shown, "onboarding")) {
    return (
      <OnboardingScreen
        key={onboardingReturn?.step ?? "start"}
        onAddProxy={claudeAccounts.addVerifiedProxy}
        onFinish={finishOnboarding}
        onOpenAuthorize={openAuthorize}
        resume={onboardingReturn}
      />
    )
  }
  if (isFlow(shown, "authorize")) {
    return (
      <AuthorizeScreen
        state={authorizationState}
        profiles={browserProfiles.profiles}
        profilesLoading={browserProfiles.loading}
        profilesError={browserProfiles.error}
        onOpenProfiles={() => navigate({ kind: "settings", page: "browser-profiles" })}
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
    <MainWindow
      location={shown}
      lastWorkspace={
        history.entries
          .slice(0, history.index + 1)
          .findLast((entry) => entry.kind === "draft" || entry.kind === "session") ?? {
          kind: "session",
        }
      }
      screen={screenOfLocation(shown)}
      canGoBack={canGoBack(history)}
      canGoForward={canGoForward(history)}
      membership={membership}
      drafts={drafts}
      claudeAccounts={claudeAccounts}
      browserProfiles={browserProfiles}
      onNavigate={navigate}
      onSessionsDeleted={(projects, selection) =>
        setHistory((current) => replaceDeletedSessionLocations(current, projects, selection))
      }
      onBack={() => setHistory(goBack)}
      onForward={() => setHistory(goForward)}
      onOpenAuthorize={() => openAuthorize()}
      onReauthorizeAccount={(accountId) => openAuthorize(undefined, accountId)}
      onLogout={() => void logout()}
      theme={appearance.resolved}
      appearance={appearance}
      previewWorkbench={previewWorkbench}
    />
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
