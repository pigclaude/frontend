// 负责组合第一方 OAuth、独立 Claude provider 端口、本机会员写入生命周期和本机 daemon。
import type { SecretVault } from "./secret-vault"
import type { MembershipView } from "@pigclaude/contracts/membership"
import type { LocalStore } from "@pigclaude/local-store"
import { AuthorizationService, type ClaudeAuthorizationAdapter } from "./authorization/service"
import { OAuthTokenManager } from "./authorization/oauth-token-manager"
import {
  PigclaudeApiClient,
  type PigclaudeApi,
  type PigclaudeApiClientOptions,
} from "./api/pigclaude-api-client"
import { CredentialRefresher } from "./claude/credential-refresher"
import { SubscriptionOAuth } from "./claude/subscription-oauth"
import { MembershipGate } from "./membership/membership-gate"
import { AccountChooser } from "./runtime/account-chooser"
import { LocalRuntime } from "./runtime/local-runtime"
import type { DeviceIdentityService } from "./device-identity"
import type { DeviceInfo } from "./device-identity/device-info"
import type { AuthorizationStateEvent } from "./authorization/types"

/** composition 的依赖，Claude adapter 与第一方 OAuth API 必须独立。 */
export type DesktopCompositionOptions = {
  api?: PigclaudeApi
  apiOptions?: PigclaudeApiClientOptions
  vault: SecretVault
  authOrigin: string
  deviceIdentity?: Pick<DeviceIdentityService, "read">
  deviceInfo?: () => Promise<DeviceInfo>
  claudeAuthorization?: ClaudeAuthorizationAdapter
  now?: () => number
  onMembershipView?: (view: MembershipView) => void
  /** 向 renderer 发布不携带秘密的保存进度。 */
  onAuthorizationState?: (event: AuthorizationStateEvent) => void
  /** 提供本机账号库时才装配 daemon 和选号；测试可省略。 */
  localStore?: LocalStore
}
/** composition 提供脱敏服务与本机退出，不跨 profile 或 Claude namespace 清理。 */
export type DesktopComposition = {
  api: PigclaudeApi
  membershipGate: MembershipGate
  authorizationService: AuthorizationService
  tokenManager: OAuthTokenManager
  /** 每次执行前实时核验会员，不能从 UI 状态授予权限。 */
  runAuthorized: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>
  /** 前台/系统恢复触发实时检查。 */
  resume: () => Promise<MembershipView>
  /** 本机第一方退出同步失效代次，不等待远端。 */
  signOut: () => Promise<MembershipView>
  /** 本机 daemon 和选号；未提供 localStore 时为 null。 */
  runtime: LocalRuntime | null
  /** 按顺序释放本机授权和会员订阅。 */
  dispose: () => Promise<void>
}

/** 装配标准 native 登录，迟到网络结果不能越过本机 generation/write fence。 */
export function createDesktopComposition(options: DesktopCompositionOptions): DesktopComposition {
  const now = options.now ?? Date.now
  const api =
    options.api ??
    new PigclaudeApiClient({
      authorizationOrigin: options.authOrigin,
      ...(options.apiOptions ?? { baseUrl: options.authOrigin }),
    })
  const tokenManager = new OAuthTokenManager({ api, vault: options.vault, now })
  const membershipGate = new MembershipGate({ api, vault: options.vault, tokenManager, now })
  const unsubscribe = options.onMembershipView
    ? membershipGate.subscribe(options.onMembershipView)
    : () => undefined
  const unavailableClaude: ClaudeAuthorizationAdapter = {
    start: async () => {
      throw new Error("CLAUDE_AUTHORIZATION_UNAVAILABLE：Claude 账号授权服务尚未配置")
    },
    exchangeCode: async () => {
      throw new Error("CLAUDE_AUTHORIZATION_UNAVAILABLE：Claude 账号授权服务尚未配置")
    },
  }
  const operations = new Set<AbortController>()
  const stopOperations = () => {
    for (const controller of operations) controller.abort()
  }
  const unsubscribeOperations = membershipGate.subscribe((view) => {
    if (view.state !== "active") stopOperations()
  })
  async function runAuthorized<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const owner = tokenManager.owner
    const revision = membershipGate.view().revision
    const view = await membershipGate.inspect()
    if (!tokenManager.isCurrent(owner) || view.state !== "active" || view.revision <= revision)
      throw new Error("MEMBERSHIP_REQUIRED")
    const controller = new AbortController()
    operations.add(controller)
    try {
      const result = await operation(controller.signal)
      if (controller.signal.aborted || !tokenManager.isCurrent(owner))
        throw new Error("MEMBERSHIP_REQUIRED")
      return result
    } finally {
      operations.delete(controller)
    }
  }
  const runtime = options.localStore
    ? new LocalRuntime({
        store: options.localStore,
        chooser: new AccountChooser({
          store: options.localStore,
          refresher: new CredentialRefresher({
            store: options.localStore,
            oauth: new SubscriptionOAuth(),
            now,
          }),
          now,
        }),
        membership: membershipGate,
        runAuthorized,
        now,
      })
    : null
  void runtime?.start()
  const claudeAuthorization = options.claudeAuthorization
    ? {
        start: (session: Parameters<ClaudeAuthorizationAdapter["start"]>[0]) =>
          runAuthorized(() => options.claudeAuthorization!.start(session)),
        exchangeCode: (input: Parameters<ClaudeAuthorizationAdapter["exchangeCode"]>[0]) =>
          runAuthorized(() => options.claudeAuthorization!.exchangeCode(input)),
      }
    : unavailableClaude
  const authorizationService = new AuthorizationService({
    authOrigin: options.authOrigin,
    vault: options.vault,
    now,
    deviceIdentity: options.deviceIdentity,
    deviceInfo: options.deviceInfo,
    claudeAuthorization,
    startAuthorization: (input) => api.prepareDeviceAuthorization(input),
    exchangeCode: async (input) => {
      if (input.session.request.purpose !== "pigclaude-login") throw new Error("授权用途不匹配")
      const oauthOwner = tokenManager.owner
      const issuedAt = now()
      const response = await api.exchangeCode(input)
      if (!tokenManager.isCurrent(oauthOwner)) throw new Error("AUTHORIZATION_CANCELLED")
      const session = await api.readDesktopSession(response.access_token)
      if (!tokenManager.isCurrent(oauthOwner)) throw new Error("AUTHORIZATION_CANCELLED")
      const oauthSession = {
        schemaVersion: 1 as const,
        protocol: "oauth2" as const,
        ...session,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        scope: response.scope,
        grantedScope: response.scope,
        accessTokenExpiresAt: issuedAt + response.expires_in * 1_000,
        refreshTokenExpiresAt: issuedAt + 30 * 24 * 60 * 60 * 1_000,
      }
      return {
        purpose: input.session.request.purpose,
        mode: input.session.request.mode,
        accountId: session.userId,
        displayName: session.userId,
        expiresAt: oauthSession.accessTokenExpiresAt,
        deviceId: session.deviceId,
        bindingEpoch: session.bindingEpoch,
        userId: session.userId,
        oauthSession,
        oauthOwner,
      }
    },
    commitAuthorization: async ({ token, isCurrent }) => {
      if (token.purpose === "pigclaude-login" && token.oauthSession) {
        if (token.oauthOwner === undefined || !tokenManager.isCurrent(token.oauthOwner))
          throw new Error("AUTHORIZATION_CANCELLED")
        stopOperations()
        await membershipGate.acceptAuthorization(token.oauthSession, isCurrent)
      }
    },
    onCompleted: async ({ token }) => {
      if (token.purpose === "pigclaude-login" && token.oauthSession) await membershipGate.inspect()
    },
    onAbandoned: async (session) => {
      if (session.request.purpose === "pigclaude-login") await membershipGate.inspect()
    },
    onProgress: options.onAuthorizationState,
  })
  const heartbeat = setInterval(() => {
    void membershipGate.inspect()
  }, 30_000)
  heartbeat.unref()
  let disposed = false
  let signingOut: Promise<MembershipView> | null = null
  return {
    api,
    membershipGate,
    authorizationService,
    tokenManager,
    runtime,
    resume: () => membershipGate.inspect(),
    runAuthorized,
    signOut: () => {
      if (disposed) return Promise.reject(new Error("桌面授权服务已关闭"))
      if (signingOut) return signingOut
      stopOperations()
      const writes = authorizationService.suspend()
      const pending = membershipGate.signOut(writes).then((view) => {
        if (!disposed) authorizationService.resume()
        return view
      })
      signingOut = pending
      const finished = () => {
        signingOut = null
      }
      void pending.then(finished, finished)
      return pending
    },
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      clearInterval(heartbeat)
      await runtime?.dispose()
      stopOperations()
      unsubscribeOperations()
      const writes = tokenManager.suspend()
      await Promise.all([authorizationService.suspend(), writes])
      unsubscribe()
      membershipGate.dispose()
    },
  }
}
