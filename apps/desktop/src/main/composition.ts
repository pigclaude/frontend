// 负责组合第一方 OAuth、独立 Claude provider 端口和本机会员写入生命周期。
import type { SecretVault } from "./secret-vault"
import type { MembershipView } from "@pigclaude/contracts/membership"
import { AuthorizationService, type ClaudeAuthorizationAdapter } from "./authorization/service"
import { parseOAuthDesktopSession } from "./authorization/oauth-session"
import {
  PigclaudeApiClient,
  type PigclaudeApi,
  type PigclaudeApiClientOptions,
} from "./api/pigclaude-api-client"
import { MembershipGate } from "./membership/membership-gate"
import type { DeviceIdentityService } from "./device-identity"

/** composition 的依赖，Claude adapter 与第一方 OAuth API 必须独立。 */
export type DesktopCompositionOptions = {
  api?: PigclaudeApi
  apiOptions?: PigclaudeApiClientOptions
  vault: SecretVault
  authOrigin: string
  deviceIdentity?: Pick<DeviceIdentityService, "read">
  claudeAuthorization?: ClaudeAuthorizationAdapter
  now?: () => number
  onMembershipView?: (view: MembershipView) => void
}
/** composition 提供脱敏服务与本机退出，不跨 profile 或 Claude namespace 清理。 */
export type DesktopComposition = {
  api: PigclaudeApi
  membershipGate: MembershipGate
  authorizationService: AuthorizationService
  /** 本机第一方退出同步失效代次，不等待远端。 */
  signOut: () => Promise<MembershipView>
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
      accessToken:
        options.apiOptions?.accessToken ??
        (async () =>
          parseOAuthDesktopSession(await options.vault.get("membership:session"))?.accessToken ??
          null),
    })
  const membershipGate = new MembershipGate({ api, vault: options.vault, now })
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
  const authorizationService = new AuthorizationService({
    authOrigin: options.authOrigin,
    vault: options.vault,
    now,
    deviceIdentity: options.deviceIdentity,
    claudeAuthorization: options.claudeAuthorization ?? unavailableClaude,
    startAuthorization: (input) => api.prepareDeviceAuthorization(input),
    exchangeCode: async (input) => {
      if (input.session.request.purpose !== "pigclaude-login") throw new Error("授权用途不匹配")
      const issuedAt = now()
      const response = await api.exchangeCode(input)
      const session = await api.readDesktopSession(response.access_token)
      const oauthSession = {
        schemaVersion: 1 as const,
        protocol: "oauth2" as const,
        ...session,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        scope: response.scope,
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
      }
    },
    commitAuthorization: async ({ token, isCurrent }) => {
      if (token.purpose === "pigclaude-login" && token.oauthSession) {
        await membershipGate.acceptAuthorization(token.oauthSession, isCurrent)
      }
    },
    onCompleted: async ({ token }) => {
      if (token.purpose === "pigclaude-login" && token.oauthSession) await membershipGate.inspect()
    },
  })
  let disposed = false
  let signingOut: Promise<MembershipView> | null = null
  return {
    api,
    membershipGate,
    authorizationService,
    signOut: () => {
      if (disposed) return Promise.reject(new Error("桌面授权服务已关闭"))
      if (signingOut) return signingOut
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
      await authorizationService.suspend()
      unsubscribe()
      membershipGate.dispose()
    },
  }
}
