// 负责会话启动前的检查和准备：会员、工作区、可用账号、daemon，再为会话注册 daemon 令牌、找 Claude 二进制，
// 最后按账号的语言时区创建会话环境。任何一步不满足都抛已脱敏的稳定错误码；被停止打断时清理已建的环境、吊销令牌，
// 不留半启动状态。

import type { ClaudeCodePluginSessionSource } from "./claude-code-plugin-session-source"
import { boundSessionEnvironment } from "./bound-session-environment"
import type { DevProviderOverride } from "./dev-provider"
import { sameProfileEnvironment } from "./profile-environment"
import type { SessionStorePaths } from "./session-store-layout"
import {
  pinnedStartInput,
  providerEnvironmentInput,
  providerSessionProfile,
} from "./session-host-provider"
import {
  assertMembershipActive,
  assertStartNotStopped,
  assertWorkspace,
  createEnvironmentOrThrow,
  readBinaryPath,
  sanitizeStartError,
} from "./session-host-support"
import { normalizeSessionLocale, normalizeSessionTimezone } from "./session-locale"
import {
  SessionHostError,
  type SessionEnvironmentFactory,
  type SessionEnvironmentPort,
  type SessionMembership,
  type SessionProfile,
  type SessionRuntime,
  type SessionRuntimeLease,
  type SessionStartInput,
} from "./session-types"

/** 启动前检查用到的宿主依赖。 */
export type SessionStartDeps = {
  membership: SessionMembership
  runtime: SessionRuntime
  provider: DevProviderOverride | null
  createEnvironment: SessionEnvironmentFactory
  claudeCodePlugins?: ClaudeCodePluginSessionSource
  resolveBinaryPath: () => string
  resolveProfile: (
    accountId: string | null,
    required?: Pick<SessionProfile, "locale" | "timezone">,
  ) => Promise<SessionProfile | null>
  userDataPath: string
  /** 启动已被停止或宿主已关闭。 */
  cancelled: () => boolean
  /** 续接时只能在保存的语言时区使用一个当前可用账号。 */
  requiredProfile?: Pick<SessionProfile, "locale" | "timezone">
}

/** 通过检查、可以交给 ClaudeSession 的启动材料。 */
export type PreparedSessionStart = {
  sessionId: string
  /** 这个会话的 daemon 令牌；环境清理时吊销。 */
  sessionToken: string
  /** 提前停止这一会话的 daemon 路由，保留环境供后续清理。 */
  revokeRouting: () => void
  /** 已按开发期供应商固定过模型的启动输入。 */
  input: SessionStartInput
  environment: SessionEnvironmentPort
  /** 进程实际绑定的环境，供保存索引用。 */
  profile: SessionProfile
}

/**
 * 为拿到进程名额的 sessionId 创建会话环境。保证返回时会员仍有效、启动未被取消，会话的令牌随环境清理吊销；
 * 抛错时不留下环境和有效令牌，错误已去掉本会话的令牌。
 */
export async function prepareSessionStart(
  deps: SessionStartDeps,
  input: SessionStartInput,
  sessionId: string,
  prepareRetained?: (profile: SessionProfile) => Promise<SessionStorePaths>,
): Promise<PreparedSessionStart> {
  assertStartNotStopped(deps.cancelled(), false)
  if (deps.membership.view().state !== "active") {
    throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
  }
  const daemonBaseUrl = daemonAddress(deps.runtime)
  const session = deps.runtime.openSession({
    sessionId,
    preferredAccountId: input.accountId ?? null,
  })
  try {
    return await prepareEnvironment(deps, input, session, daemonBaseUrl, prepareRetained)
  } catch (error) {
    session.close()
    throw sanitizeStartError(error, session.token)
  }
}

/** 在进程名额以外校验会员、工作区、可用账号和 daemon，成功时返回工作区的真实路径。 */
export async function checkSessionStart(
  deps: SessionStartDeps,
  input: SessionStartInput,
): Promise<string> {
  const assertNotCancelled = (): void => assertStartNotStopped(deps.cancelled(), false)
  assertNotCancelled()
  await assertMembershipActive(deps.membership)
  assertNotCancelled()
  const workspace = await assertWorkspace(input.workspace)
  assertNotCancelled()
  // 开发期供应商自带模型访问，不需要本机有可用的 Claude 账号。
  if (deps.provider === null && !(await deps.runtime.hasAvailableAccount())) {
    throw new SessionHostError("NO_AVAILABLE_ACCOUNT", "没有可用的 Claude 账号")
  }
  if (deps.requiredProfile !== undefined) await resolveSessionProfile(deps, input)
  assertNotCancelled()
  daemonAddress(deps.runtime)
  return workspace
}

function daemonAddress(runtime: SessionRuntime): string {
  const daemonBaseUrl = runtime.daemonBaseUrl
  if (daemonBaseUrl === null) {
    throw new SessionHostError("DAEMON_UNAVAILABLE", "本机 daemon 尚未就绪")
  }
  return daemonBaseUrl
}

async function prepareEnvironment(
  deps: SessionStartDeps,
  input: SessionStartInput,
  session: SessionRuntimeLease,
  daemonBaseUrl: string,
  prepareRetained?: (profile: SessionProfile) => Promise<SessionStorePaths>,
): Promise<PreparedSessionStart> {
  const { sessionId, token } = session
  const binaryPath = readBinaryPath(deps.resolveBinaryPath, token)
  const profile = await resolveSessionProfile(deps, input)
  assertStartNotStopped(deps.cancelled(), false)
  const retainedPaths = await prepareRetained?.(profile)
  assertStartNotStopped(deps.cancelled(), false)
  const environment = await createEnvironmentOrThrow(
    (environmentInput) =>
      boundSessionEnvironment(session, profile, deps.createEnvironment, environmentInput),
    {
      sessionId,
      workspace: input.workspace,
      daemonBaseUrl,
      sessionToken: token,
      timezone: normalizeSessionTimezone(profile?.timezone),
      locale: normalizeSessionLocale(profile?.locale),
      binaryPath,
      userDataPath: deps.userDataPath,
      loadProjectConfiguration: true,
      ...(deps.claudeCodePlugins === undefined
        ? {}
        : { claudeCodePlugins: deps.claudeCodePlugins }),
      ...(retainedPaths === undefined ? {} : { retainedPaths }),
      ...providerEnvironmentInput(deps.provider),
    },
    token,
  )
  if (deps.cancelled()) {
    await environment.cleanup().catch(() => undefined)
    throw new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
  }
  if (deps.membership.view().state !== "active") {
    await environment.cleanup().catch(() => undefined)
    throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
  }
  return {
    sessionId,
    sessionToken: token,
    revokeRouting: () => session.close(),
    input: pinnedStartInput(deps.provider, input),
    environment,
    profile,
  }
}

async function resolveSessionProfile(
  deps: SessionStartDeps,
  input: SessionStartInput,
): Promise<SessionProfile> {
  const required = deps.requiredProfile
  const resolved = await deps.resolveProfile(input.accountId ?? null, required)
  const profile = deps.provider === null ? resolved : providerSessionProfile(required ?? resolved)
  if (required !== undefined && (profile === null || !sameProfileEnvironment(profile, required))) {
    throw new SessionHostError("ACCOUNT_ENVIRONMENT_MISMATCH", "没有原语言和时区的可用 Claude 账号")
  }
  if (profile === null) {
    throw new SessionHostError("NO_AVAILABLE_ACCOUNT", "账号没有可用的浏览器配置")
  }
  return required === undefined
    ? profile
    : { ...profile, locale: required.locale, timezone: required.timezone }
}
