// 负责拿到名额之后把一个会话真正启动起来：启动前检查、组装 ClaudeSession、启动 Claude Code 并进入请求的权限模式。
// 被停止或会员失效打断时清理已建的环境并抛对应的错误码，不留半启动状态；会话对象一建好就交给宿主，便于中途停止。

import { ClaudeSession } from "./claude-session"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { SessionEnvironment } from "./session-environment"
import { SessionClaudeExitError } from "./session-claude-launch"
import type { DevProviderOverride } from "./dev-provider"
import type { SessionEnvelope } from "./session-envelope"
import { prepareSavedSession, type PersistedSessionLaunch } from "./session-persistence"
import { sessionInstance, type SessionIndex } from "./session-index"
import { SessionReferenceAccess } from "./session-reference-access"
import type { SessionStore } from "./session-store"
import type { SessionSavedSettings } from "./claude-session"
import { createThreadReadServer, threadReadServerName } from "./thread-read"
import type { SessionTimers } from "./session-host-active"
import { mapStartError } from "./session-host-support"
import type { SessionCancelCode } from "./session-registry"
import {
  checkSessionStart,
  prepareSessionStart,
  type PreparedSessionStart,
  type SessionStartDeps,
} from "./session-start-checks"
import {
  SessionHostError,
  type SessionAdapterFactory,
  type SessionEnvironmentFactory,
  type SessionMembership,
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
  resolveProfile: SessionStartDeps["resolveProfile"]
  userDataPath: string
  usage: SessionUsagePort
  permissionTimeoutMs: number
  timers: SessionTimers
  now: () => number
  newId: () => string
}

/** 供应可替换的启动端口，并使用桌面应用的默认实现。 */
export function createSessionLaunchDeps(
  options: Pick<SessionLaunchDeps, "membership" | "runtime" | "usage" | "userDataPath"> &
    Partial<SessionLaunchDeps>,
  timers: SessionTimers,
  now: () => number,
  newId: () => string,
): SessionLaunchDeps {
  return {
    membership: options.membership,
    runtime: options.runtime,
    provider: options.provider ?? null,
    createEnvironment: options.createEnvironment ?? SessionEnvironment.create,
    createAdapter: options.createAdapter ?? ((onEvent) => new ClaudeAgentAdapter({ onEvent })),
    resolveBinaryPath: options.resolveBinaryPath ?? (() => resolveClaudeBinaryPath()),
    resolveProfile: options.resolveProfile ?? (async () => null),
    userDataPath: options.userDataPath,
    usage: options.usage,
    permissionTimeoutMs: options.permissionTimeoutMs ?? 10 * 60_000,
    timers,
    now,
    newId,
  }
}

/** 一次启动和宿主之间的回调。 */
export type SessionLaunchHooks = {
  /** 启动被打断的原因；没有被打断时为 null。 */
  cancelled: () => SessionCancelCode | null
  /** 领取进程名额，拿到后返回是否排过队。 */
  acquire: () => Promise<boolean>
  /** 按请求顺序完成初次检查和排队登记，后来的启动不会越过先来的启动。 */
  checkBeforeQueue: <T>(check: () => Promise<T>) => Promise<T>
  /** 会话对象建好、Claude Code 还没启动时调用一次。 */
  opened: (session: ClaudeSession, canonicalWorkspace: string) => void
  emit: (envelope: SessionEnvelope) => void
  /** Claude Code 报告的在途后台任务数（含回合不等的后台 shell）变了。 */
  backgroundTasks: (count: number) => void
  /** 会话释放时调用一次。 */
  released: () => void | Promise<void>
  /** 适配器确认修改模型或发送设置后更新会话索引。 */
  saveSettings?: (settings: SessionSavedSettings) => void
}

/** 启动需要的本机存储以及已有索引，第一次启动没有旧索引。 */
export type SessionLaunchStorage = { store: SessionStore; index: SessionIndex | null }

/** 依次执行初次启动检查，保留请求入队顺序。 */
export function orderedSessionChecks(): SessionLaunchHooks["checkBeforeQueue"] {
  let tail = Promise.resolve()
  return (check) => {
    const result = tail.then(check)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

/** 生成停止或会员失效打断启动时的错误。 */
export function sessionLaunchCancellation(code: SessionCancelCode): SessionHostError {
  return code === "MEMBERSHIP_REQUIRED"
    ? new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
    : new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
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
  storage?: SessionLaunchStorage,
): Promise<ClaudeSession> {
  const interrupted = (): SessionHostError | null => {
    const code = hooks.cancelled()
    if (code === null) return null
    return sessionLaunchCancellation(code)
  }
  const startDeps: SessionStartDeps = {
    ...deps,
    cancelled: () => hooks.cancelled() !== null,
    ...(storage?.index == null ? {} : { requiredProfile: storage.index.environment }),
  }
  let canonicalWorkspace: string
  let prepared: PreparedSessionStart
  let persistence: PersistedSessionLaunch | undefined
  try {
    const queued = await hooks.checkBeforeQueue(async () => ({
      workspace: await checkSessionStart(startDeps, input),
      slot: hooks.acquire(),
    }))
    canonicalWorkspace = (await queued.slot)
      ? await checkSessionStart(startDeps, input)
      : queued.workspace
    prepared = await prepareSessionStart(
      startDeps,
      input,
      sessionId,
      storage === undefined
        ? undefined
        : async (profile) => {
            persistence = await prepareSavedSession(
              storage.store,
              sessionId,
              input,
              profile,
              storage.index,
              deps.now(),
            )
            return persistence.paths
          },
    )
  } catch (error) {
    throw interrupted() ?? error
  }
  const saved = storage?.store.get(sessionId)
  const references =
    storage && saved ? new SessionReferenceAccess(storage.store, sessionInstance(saved)) : undefined
  const session = new ClaudeSession({
    ...prepared,
    ...(references === undefined ? {} : { references }),
    ...(persistence === undefined ? {} : { persistence }),
    ...(hooks.saveSettings === undefined ? {} : { saveSettings: hooks.saveSettings }),
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
  hooks.opened(session, canonicalWorkspace)
  try {
    if (references !== undefined) {
      const reader = createThreadReadServer((id) =>
        references.read(
          id,
          () =>
            !session.closing && interrupted() === null && deps.membership.view().state === "active",
        ),
      )
      servers = { ...servers, [threadReadServerName]: reader }
    }
    await session.launch(servers)
  } catch (error) {
    if (error instanceof SessionClaudeExitError) throw error
    await session.end("会话启动失败", null)
    throw interrupted() ?? mapStartError(error, prepared.sessionToken)
  }
  const stopped = interrupted()
  if (stopped !== null) {
    await session.end("会话启动已取消", null)
    throw stopped
  }
  if (session.closing) {
    await session.end("会话启动期间结束", null)
    if (deps.membership.view().state !== "active") {
      throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
    }
    throw new SessionHostError("SDK_ERROR", "会话在启动期间结束")
  }
  session.announceMode()
  return session
}
