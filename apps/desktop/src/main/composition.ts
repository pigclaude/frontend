// 负责在 Electron 主进程组合 Rust API、会员 gate 和浏览器授权，并按逆序释放资源。
import type { SecretVault } from "./secret-vault"
import { AuthorizationService, type AuthorizationExchange } from "./authorization/service"
import type { AuthorizationToken } from "./authorization/types"
import {
  PigclaudeApiClient,
  type PigclaudeApi,
  type PigclaudeApiClientOptions,
} from "./api/pigclaude-api-client"
import { MembershipGate } from "./membership/membership-gate"

/** Desktop composition 的外部依赖，保证 Electron 运行时只负责装配。 */
export type DesktopCompositionOptions = {
  api?: PigclaudeApi
  apiOptions?: PigclaudeApiClientOptions
  vault: SecretVault
  authOrigin: string
  deviceId?: string
  deviceFingerprintHash?: string
  now?: () => number
  onMembershipView?: (view: Awaited<ReturnType<MembershipGate["inspect"]>>) => void
}

/** 第一阶段桌面组合结果；daemon 和 session host 尚未进入这个边界。 */
export type DesktopComposition = {
  api: PigclaudeApi
  membershipGate: MembershipGate
  authorizationService: AuthorizationService
  dispose: () => Promise<void>
}

/** 创建 Rust API、会员 gate 和授权服务，并保证清理顺序可预测。 */
export function createDesktopComposition(options: DesktopCompositionOptions): DesktopComposition {
  const api =
    options.api ??
    new PigclaudeApiClient({
      ...(options.apiOptions ?? { baseUrl: options.authOrigin }),
      accessToken: options.apiOptions?.accessToken ?? (async () => readAccessToken(options.vault)),
      sessionCookie:
        options.apiOptions?.sessionCookie ?? (async () => readSessionCookie(options.vault)),
    })
  const membershipGate = new MembershipGate({
    api,
    vault: options.vault,
    now: options.now,
  })
  const unsubscribe = options.onMembershipView
    ? membershipGate.subscribe(options.onMembershipView)
    : () => undefined
  const authorizationService = new AuthorizationService({
    authOrigin: options.authOrigin,
    vault: options.vault,
    now: options.now,
    deviceId: () => options.deviceId ?? "pigclaude-desktop",
    deviceFingerprintHash: () => options.deviceFingerprintHash ?? "pigclaude-desktop",
    startAuthorization: (input) => api.startAuthorization(input),
    exchangeCode: (input) => exchange(api, input),
    onCompleted: async ({ token }) => {
      if (!token.deviceId || !token.bindingEpoch) return
      await membershipGate.acceptAuthorization({
        deviceId: token.deviceId,
        bindingEpoch: token.bindingEpoch,
        accountId: token.userId ?? token.accountId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        credential: token.credential,
        sessionCookie: token.sessionCookie,
      })
      await membershipGate.inspect()
    },
  })
  let disposed = false
  return {
    api,
    membershipGate,
    authorizationService,
    async dispose(): Promise<void> {
      if (disposed) return
      disposed = true
      unsubscribe()
      membershipGate.dispose()
    },
  }
}

async function readAccessToken(vault: SecretVault): Promise<string | null> {
  const raw = await vault.get("membership:session").catch(() => null)
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const token = (value as Record<string, unknown>).accessToken
    return typeof token === "string" && token.length > 0 ? token : null
  } catch {
    return null
  }
}

async function readSessionCookie(vault: SecretVault): Promise<string | null> {
  const raw = await vault.get("membership:session").catch(() => null)
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    const cookie = (value as Record<string, unknown>).sessionCookie
    return typeof cookie === "string" && cookie.length > 0 ? cookie : null
  } catch {
    return null
  }
}

async function exchange(
  api: Pick<PigclaudeApi, "exchangeAuthorization">,
  input: AuthorizationExchange,
): Promise<AuthorizationToken> {
  const flowId = input.session.flowId
  if (!flowId) throw new Error("授权 flow 尚未创建")
  const result = await api.exchangeAuthorization({
    flowId,
    code: input.code,
    codeVerifier: input.codeVerifier,
    state: input.session.state,
  })
  return {
    accessToken: undefined,
    refreshToken: undefined,
    accountId: result.userId,
    displayName: result.userId,
    expiresAt: Date.now() + 3_600_000,
    purpose: input.session.request.purpose,
    mode: input.session.request.mode,
    deviceId: result.deviceId,
    bindingEpoch: result.bindingEpoch,
    userId: result.userId,
    sessionCookie: result.sessionCookie,
  }
}
