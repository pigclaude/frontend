// 负责 SessionHost 的纯辅助逻辑：工作区校验、启动错误映射、系统时区回退、用量记录构造和秘密脱敏。
// 除工作区状态检查外不做 I/O、不持有会话状态，便于单独审查和保持主文件行数在上限内。

import { constants } from "node:fs"
import { access, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import type { ClaudeAgentStartOptions } from "./claude-agent-adapter"
import type { PermissionBroker } from "./permission-broker"
import type { SessionEvent } from "./session-events"
import type {
  SessionAdapterPort,
  SessionEnvironmentPort,
  SessionPermissionMode,
  SessionStartInput,
} from "./session-types"
import { SessionHostError } from "./session-types"
import type { UsageRecord } from "./usage-recorder"

/** 一个活动会话的全部可变状态；只有 SessionHost 会修改它。 */
export type ActiveSession = {
  sessionId: string
  environment: SessionEnvironmentPort
  adapter: SessionAdapterPort
  broker: PermissionBroker
  abort: AbortController
  model: string | null
  permissionMode: SessionPermissionMode
  accountId: string | null
  switchedFrom: string | null
  turnId: string | null
  turnCancelled: boolean
  turnErrorCode: string | null
  stopping: boolean
  ending: Promise<void> | null
  released: boolean
}

/** 构造用量记录所需的 turn 状态；由 SessionHost 的活动会话结构满足。 */
export type UsageTurnState = {
  sessionId: string
  turnId: string | null
  accountId: string | null
  model: string | null
  switchedFrom: string | null
  turnCancelled: boolean
  turnErrorCode: string | null
}

/** 校验工作区是存在、可读的绝对目录；否则统一抛 WORKSPACE_UNAVAILABLE。 */
export async function assertWorkspace(workspace: string): Promise<void> {
  if (!isAbsolute(workspace)) {
    throw new SessionHostError("WORKSPACE_UNAVAILABLE", "工作区必须是绝对路径")
  }
  try {
    const info = await stat(workspace)
    if (!info.isDirectory()) throw new Error("not a directory")
    await access(workspace, constants.R_OK)
  } catch {
    throw new SessionHostError("WORKSPACE_UNAVAILABLE", "工作区不存在或不可读")
  }
}

/** 把适配器启动错误映射为稳定错误码；未知错误归为 SDK_ERROR。 */
export function mapStartError(error: unknown): SessionHostError {
  if (error instanceof SessionHostError) return error
  const message = errorMessage(error)
  if (message.includes("CLAUDE_RUNTIME_UNAVAILABLE")) {
    return new SessionHostError("CLAUDE_RUNTIME_UNAVAILABLE", message)
  }
  return new SessionHostError("SDK_ERROR", message)
}

/** 用当前 turn 和 result 事件构造只含元数据的用量记录；没有 turn 时返回 null。 */ export function buildUsageRecord(
  turn: UsageTurnState,
  event: Extract<SessionEvent, { type: "result" }>,
  now: number,
): UsageRecord | null {
  if (turn.turnId === null) return null
  const status: UsageRecord["status"] = turn.turnCancelled
    ? "cancelled"
    : event.isError || turn.turnErrorCode !== null
      ? "error"
      : "success"
  const errorCode = turn.turnCancelled
    ? "SESSION_CANCELLED"
    : status === "error"
      ? (turn.turnErrorCode ?? "SDK_ERROR")
      : null
  return {
    schemaVersion: 1,
    at: new Date(now).toISOString(),
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    accountId: turn.accountId,
    model: turn.model,
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
    cacheReadTokens: event.usage.cacheReadTokens,
    cacheCreationTokens: event.usage.cacheCreationTokens,
    durationMs: event.durationMs,
    status,
    errorCode,
    switchedFrom: turn.switchedFrom,
  }
}

/** 把活动会话和启动输入转换成适配器参数；canUseTool 直接写入 PermissionBroker。 */
export function buildStartOptions(
  active: ActiveSession,
  input: SessionStartInput,
): ClaudeAgentStartOptions {
  return {
    workspace: active.environment.workspace,
    env: active.environment.env,
    permissionMode: input.permissionMode,
    canUseTool: (toolName, toolInput, options) =>
      active.broker.request(toolName, toolInput, options),
    abortController: active.abort,
    binaryPath: active.environment.binaryPath,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
  }
}

/** 从事件文本里去掉 daemon 会话令牌，避免错误消息带秘密。 */
export function redactSessionToken(message: string, token: string): string {
  return token === "" ? message : message.split(token).join("[redacted]")
}

/** 返回宿主系统的 IANA 时区；取不到时回退 UTC。 */
export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

/** 返回宿主系统的 locale；取不到时回退 en-US。 */
export function systemLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
}

/** 提取可展示的错误文本；非 Error 值转成字符串。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
