// 负责 SessionHost 的纯辅助逻辑：工作区校验、启动错误映射、系统时区回退、用量记录构造和秘密脱敏。
// 除工作区状态检查外不做 I/O、不持有会话状态，便于单独审查和保持主文件行数在上限内。

import { constants } from "node:fs"
import { access, realpath, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import type { CapabilityPluginToolApprovals } from "../plugins/capability-plugin-tools"
import { routeCanUseTool } from "./can-use-tool"
import type { ClaudeAgentStartOptions } from "./claude-query-options"
import type { SessionEnvironmentInput } from "./session-environment"
import type { SessionEvent } from "./session-events"
import type { ActiveSession } from "./session-host-active"
import type { ClosedTurn } from "./session-turns"
import type {
  SessionEnvironmentFactory,
  SessionEnvironmentPort,
  SessionErrorCode,
  SessionMembership,
  SessionStartInput,
  SessionStatusView,
} from "./session-types"
import { classifyDaemonError } from "./session-error-mapping"
import { SessionHostError } from "./session-types"
import type { UsageRecord } from "./usage-recorder"

/** 构造用量记录所需的会话状态；由活动会话结构满足。 */
export type UsageTurnState = {
  sessionId: string
  accountId: string | null
  model: string | null
  switchedFrom: string | null
}

/** 返回存在、可读的工作区的真实路径；校验失败统一抛 WORKSPACE_UNAVAILABLE。 */
export async function assertWorkspace(workspace: string): Promise<string> {
  if (!isAbsolute(workspace)) {
    throw new SessionHostError("WORKSPACE_UNAVAILABLE", "工作区必须是绝对路径")
  }
  try {
    const directory = await realpath(workspace)
    const info = await stat(directory)
    if (!info.isDirectory()) throw new Error("not a directory")
    await access(directory, constants.R_OK)
    return directory
  } catch {
    throw new SessionHostError("WORKSPACE_UNAVAILABLE", "工作区不存在或不可读")
  }
}

/** 把适配器启动错误映射为稳定错误码并去掉会话令牌；未知错误归为 SDK_ERROR。 */
export function mapStartError(error: unknown, token: string): SessionHostError {
  if (error instanceof SessionHostError) return sanitizeSessionError(error, token)
  const message = redactSessionToken(errorMessage(error), token)
  if (message.includes("CLAUDE_RUNTIME_UNAVAILABLE")) {
    return new SessionHostError("CLAUDE_RUNTIME_UNAVAILABLE", message)
  }
  const daemonCode = classifyDaemonError(message)
  return new SessionHostError(daemonCode ?? "SDK_ERROR", message)
}

/** 去掉 SessionHostError.message 里的重复错误码前缀和会话令牌。 */
export function sanitizeSessionError(error: SessionHostError, token: string): SessionHostError {
  const prefix = `${error.code}: `
  const message = error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message
  const redacted = redactSessionToken(message, token)
  return redacted === message ? error : new SessionHostError(error.code, redacted)
}

/** 启动流程最外层出口：所有错误先脱敏再交给 IPC。 */
export function sanitizeStartError(error: unknown, token: string): SessionHostError {
  if (error instanceof SessionHostError) return sanitizeSessionError(error, token)
  return new SessionHostError("SDK_ERROR", redactSessionToken(errorMessage(error), token))
}

/** 用刚结束的一轮构造只含元数据的用量记录：正常结束记成功，出错记错误，被停止记取消。 */
export function buildUsageRecord(
  state: UsageTurnState,
  turn: ClosedTurn,
  now: number,
): UsageRecord {
  const status: UsageRecord["status"] =
    turn.status === "completed" ? "success" : turn.status === "error" ? "error" : "cancelled"
  return {
    schemaVersion: 1,
    at: new Date(now).toISOString(),
    sessionId: state.sessionId,
    turnId: turn.turnId,
    accountId: state.accountId,
    model: state.model,
    inputTokens: turn.usage.inputTokens,
    outputTokens: turn.usage.outputTokens,
    cacheReadTokens: turn.usage.cacheReadTokens,
    cacheCreationTokens: turn.usage.cacheCreationTokens,
    durationMs: turn.durationMs,
    status,
    errorCode: status === "success" ? null : turn.errorCode,
    switchedFrom: state.switchedFrom,
  }
}

/** 把活动会话和启动输入转换成适配器参数；按会话的启动模式启动，canUseTool 按工具名分给提问代理或权限代理。 */
export function buildStartOptions(
  active: ActiveSession,
  input: SessionStartInput,
  hasThreadRead: boolean,
  denyUnattended?: () => void,
  pluginApprovals?: CapabilityPluginToolApprovals,
): ClaudeAgentStartOptions {
  return {
    workspace: active.environment.workspace,
    env: active.environment.env,
    ...(active.environment.projectConfiguration === undefined
      ? {}
      : { projectConfiguration: active.environment.projectConfiguration }),
    permissionMode: active.permissionMode,
    canUseTool: routeCanUseTool(
      active.broker,
      active.questions,
      hasThreadRead,
      denyUnattended,
      pluginApprovals,
    ),
    abortController: active.abort,
    binaryPath: active.environment.binaryPath,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    ...(input.fast === undefined ? {} : { fast: input.fast }),
  }
}

/** 退出会结束的会话数、进行中的回合数和待审批请求数。 */
export type SessionPendingWork = { runningSessions: number; turns: number; approvals: number }

/** 没有会中断的工作。 */
export const noPendingWork: SessionPendingWork = Object.freeze({
  runningSessions: 0,
  turns: 0,
  approvals: 0,
})

/** 统计活动会话里退出会中断的工作；没有会话或会话正在结束时都为 0。 */
export function pendingWorkOf(active: ActiveSession | null): SessionPendingWork {
  if (active === null || active.stopping || active.released) return noPendingWork
  return {
    runningSessions: 1,
    turns: active.turns.turnId === null ? 0 : 1,
    approvals: active.broker.pendingCount,
  }
}

/** 返回脱敏会话快照；没有活动会话时所有 id 和模型为 null。 */
export function buildStatusView(active: ActiveSession | null): SessionStatusView {
  if (active === null) {
    return {
      active: false,
      sessionId: null,
      model: null,
      permissionMode: "default",
      accountId: null,
      pendingPermissions: 0,
      pendingQuestions: 0,
      turnId: null,
    }
  }
  return {
    active: true,
    sessionId: active.sessionId,
    model: active.model,
    permissionMode: active.permissionMode,
    accountId: active.accountId,
    pendingPermissions: active.broker.pendingCount,
    pendingQuestions: active.questions.pendingCount,
    turnId: active.turns.turnId,
  }
}

/** 从事件文本里去掉 daemon 会话令牌，避免错误消息带秘密。 */
export function redactSessionToken(message: string, token: string): string {
  return token === "" ? message : message.split(token).join("[redacted]")
}

/** 广播前脱敏：只有 error 事件可能带会话令牌。 */
export function sanitizeSessionEvent(event: SessionEvent, token: string): SessionEvent {
  if (event.type !== "error") return event
  if (classifyDaemonError(event.message) === "ACCOUNT_ENVIRONMENT_MISMATCH")
    return {
      ...event,
      code: "ACCOUNT_ENVIRONMENT_MISMATCH",
      message: "没有与当前会话的语言、时区及代理绑定状态兼容的账号。请选择目标账号并重新开始会话。",
    }
  return { ...event, message: redactSessionToken(event.message, token) }
}

/** 实时核验会员；inspect 失败或状态不是 active 时统一抛 MEMBERSHIP_REQUIRED。 */
export async function assertMembershipActive(membership: SessionMembership): Promise<void> {
  let state: string
  try {
    state = (await membership.inspect()).state
  } catch {
    throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
  }
  if (state !== "active") {
    throw new SessionHostError("MEMBERSHIP_REQUIRED", "会员状态不可用")
  }
}

/** 解析 Claude 二进制路径；失败映射为 CLAUDE_RUNTIME_UNAVAILABLE 并脱敏。 */
export function readBinaryPath(resolve: () => string, token: string): string {
  try {
    return resolve()
  } catch (error) {
    throw new SessionHostError(
      "CLAUDE_RUNTIME_UNAVAILABLE",
      redactSessionToken(errorMessage(error), token),
    )
  }
}

/** 创建会话环境；失败映射为 SESSION_START_FAILED 并脱敏。 */
export async function createEnvironmentOrThrow(
  create: SessionEnvironmentFactory,
  input: SessionEnvironmentInput,
  token: string,
): Promise<SessionEnvironmentPort> {
  try {
    return await create(input)
  } catch (error) {
    throw new SessionHostError(
      "SESSION_START_FAILED",
      redactSessionToken(errorMessage(error), token),
    )
  }
}

/** 启动过程中被 stop/dispose 打断时统一抛出 SESSION_CANCELLED。 */
export function assertStartNotStopped(stopRequested: boolean, disposed: boolean): void {
  if (stopRequested || disposed) {
    throw new SessionHostError("SESSION_CANCELLED", "会话启动已取消")
  }
}

/** 构造已脱敏的会话错误。 */
export function hostError(
  code: SessionErrorCode,
  message: string,
  token: string,
): SessionHostError {
  return new SessionHostError(code, redactSessionToken(message, token))
}

/** 提取可展示的错误文本；非 Error 值转成字符串。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
