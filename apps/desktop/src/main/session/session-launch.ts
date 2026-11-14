// 负责拿到名额之后把一个会话真正启动起来：启动前检查、组装 ClaudeSession、启动 Claude Code 并进入请求的权限模式。
// 被停止或会员失效打断时清理已建的环境并抛对应的错误码，不留半启动状态；会话对象一建好就交给宿主，便于中途停止。

import { ClaudeSession } from "./claude-session"
import type { DevProviderOverride } from "./dev-provider"
import type { SessionEnvelope } from "./session-envelope"
import type { SessionTimers } from "./session-host-active"
import { mapStartError } from "./session-host-support"
import type { SessionCancelCode } from "./session-registry"
import { prepareSessionStart } from "./session-start-checks"
import {
  SessionHostError,
  type SessionAdapterFactory,
  type SessionEnvironmentFactory,
  type SessionMembership,
  type SessionProfile,
  type SessionRuntime,
  type SessionStartInput,
  type SessionTools,
  type SessionUsagePort,
} from "./session-types"

/** 启动会话用到的宿主依赖；所有会话共用。 */
export type SessionLaunchDeps = {
  membership: SessionMembership
  runtime: SessionRuntime
  provider: DevProviderOverride | null
  createEnvironment: SessionEnvironmentFactory
  createAdapter: SessionAdapterFactory
  resolveBinaryPath: () => string
  resolveProfile: (accountId: string | null) => Promise<SessionProfile | null>
  userDataPath: string
  usage: SessionUsagePort
  permissionTimeoutMs: number
  timers: SessionTimers
  now: () => number
  newId: () => string
}

/** 一次启动和宿主之间的回调。 */
export type SessionLaunchHooks = {
  /** 启动被打断的原因；没有被打断时为 null。 */
  cancelled: () => SessionCancelCode | null
  /** 会话对象建好、Claude Code 还没启动时调用一次。 */
  opened: (session: ClaudeSession) => void
  emit: (envelope: SessionEnvelope) => void
  /** Claude Code 报告的在途后台任务数（含回合不等的后台 shell）变了。 */
  backgroundTasks: (count: number) => void
  /** 会话释放时调用一次。 */
  released: () => void
}

/**
 * 启动 sessionId 这个会话并返回它。保证返回时 Claude Code 已启动、模式已广播；抛错时会话已释放、令牌已吊销，
 * 错误已脱敏：被停止时为 SESSION_CANCELLED，会员失效时为 MEMBERSHIP_REQUIRED。
 */
export async function launchSession(
  deps: SessionLaunchDeps,
  input: SessionStartInput,
  sessionId: string,
  hooks: SessionLaunchHooks,
  servers?: SessionTools["servers"],
): Promise<ClaudeSession> {
  const interrupted = (): SessionHostError | null => {
    const code = hooks.cancelled()
    if (code === null) return null
    return code === "MEMBERSHIP_REQUIRED"
      ? new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
      : new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
  }
  const prepared = await prepareSessionStart(
    { ...deps, cancelled: () => hooks.cancelled() !== null },
    input,
    sessionId,
  ).catch((error: unknown) => {
    throw interrupted() ?? error
  })
  const session = new ClaudeSession({
    ...prepared,
    createAdapter: (onEvent) =>
      deps.createAdapter((event) => {
        if (event.type === "background-tasks") {
          hooks.backgroundTasks(event.taskIds.length + event.ambientTaskIds.length)
        }
        onEvent(event)
      }),
    emit: hooks.emit,
    recordUsage: (record) => void deps.usage.record(record),
    sessionToken: () => prepared.sessionToken,
    provider: deps.provider,
    permissionTimeoutMs: deps.permissionTimeoutMs,
    timers: deps.timers,
    now: deps.now,
    newId: deps.newId,
    onReleased: () => hooks.released(),
  })
  hooks.opened(session)
  try {
    await session.launch(servers)
  } catch (error) {
    await session.release()
    throw interrupted() ?? mapStartError(error, prepared.sessionToken)
  }
  const stopped = interrupted()
  if (stopped !== null) {
    await session.release()
    throw stopped
  }
  if (session.closing) {
    if (deps.membership.view().state !== "active") {
      throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
    }
    throw new SessionHostError("SDK_ERROR", "会话在启动期间结束")
  }
  session.announceMode()
  return session
}
