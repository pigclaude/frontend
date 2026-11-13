// 负责注册 session.* 和只读 usage.summary 的 IPC；所有 renderer 输入在 main 侧校验后再交给 SessionHost。

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import type { SessionHost } from "./session-host"
import {
  SessionHostError,
  type PermissionAnswer,
  type SessionEffort,
  type SessionPermissionMode,
  type SessionSendInput,
  type SessionStartInput,
  type SessionThinking,
  type UsageRange,
} from "./session-types"
import type { UsageRecorder } from "./usage-recorder"
import { captureSessionCheckpoint } from "../workbench/session-checkpoints"
import type { ClaudeAgentStartOptions } from "./claude-agent-adapter"

const permissionModes = new Set<SessionPermissionMode>([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
])
const thinkingLevels = new Set<SessionThinking>(["off", "low", "medium", "high"])
const effortLevels = new Set<SessionEffort>(["low", "medium", "high", "xhigh", "max"])
const maxUpdatedPermissions = 50
const maxUpdatedPermissionsBytes = 64 * 1024

/** 会话 IPC 依赖；host 和用量记录器可能在窗口创建后仍未装配。 */
export type SessionIpcOptions = {
  getHost: () => SessionHost | null
  getUsage: () => Pick<UsageRecorder, "summary"> | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  tools?: (event: IpcMainInvokeEvent) => ClaudeAgentStartOptions["mcpServers"]
}

/** 注册会话命令和只读用量汇总。保证写操作只接受主窗口当前 frame。 */
export function registerSessionIpc(options: SessionIpcOptions): void {
  ipcMain.handle("pigclaude:session-start", async (event, value: unknown) => {
    assertTrusted(options, event)
    const input = readSessionStartInput(value)
    return options.tools
      ? requireHost(options).start(input, options.tools(event))
      : requireHost(options).start(input)
  })
  ipcMain.handle("pigclaude:session-send", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireHost(options).send(readSessionSendInput(value), (workspace, phase) =>
      captureSessionCheckpoint(event.sender, workspace, phase),
    )
  })
  ipcMain.handle("pigclaude:session-cancel", async (event) => {
    assertTrusted(options, event)
    await requireHost(options).cancel()
  })
  ipcMain.handle("pigclaude:session-respond-permission", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireHost(options).respondPermission(readPermissionAnswer(value))
  })
  ipcMain.handle("pigclaude:session-set-mode", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireHost(options).setMode(readPermissionMode(value))
  })
  ipcMain.handle("pigclaude:session-set-model", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireHost(options).setModel(readModel(value))
  })
  ipcMain.handle("pigclaude:session-stop", async (event) => {
    assertTrusted(options, event)
    await requireHost(options).stop()
  })
  ipcMain.handle("pigclaude:session-models", async (event) => {
    assertTrusted(options, event)
    return requireHost(options).models()
  })
  ipcMain.handle("pigclaude:session-status", async (event) => {
    assertTrusted(options, event)
    return requireHost(options).status()
  })
  ipcMain.handle("pigclaude:usage-summary", async (event, value: unknown) => {
    assertTrusted(options, event)
    const usage = options.getUsage()
    if (usage === null) throw new SessionHostError("SDK_ERROR", "用量记录尚未准备好")
    return usage.summary(readUsageRange(value))
  })
}

/** 解析 session.start 输入；拒绝非对象、相对工作区、未知模式和空模型。 */
export function readSessionStartInput(value: unknown): SessionStartInput {
  if (!isRecord(value)) throw invalidInput()
  const workspace = readString(value.workspace)
  const permissionMode = readPermissionMode(value.permissionMode)
  const model = readOptionalString(value.model)
  const accountId = readOptionalString(value.accountId)
  const thinking = value.thinking
  if (thinking !== undefined && !thinkingLevels.has(thinking as SessionThinking)) {
    throw invalidInput()
  }
  const effort = value.effort
  if (effort !== undefined && !effortLevels.has(effort as SessionEffort)) {
    throw invalidInput()
  }
  const fast = value.fast
  if (fast !== undefined && typeof fast !== "boolean") throw invalidInput()
  if (workspace === null) throw invalidInput()
  return {
    workspace,
    permissionMode,
    ...(model === undefined ? {} : { model }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(thinking === undefined ? {} : { thinking: thinking as SessionThinking }),
    ...(effort === undefined ? {} : { effort: effort as SessionEffort }),
    ...(fast === undefined ? {} : { fast }),
  }
}

/** 解析 session.send 输入；附件只接受非空字符串数组。 */
export function readSessionSendInput(value: unknown): SessionSendInput {
  if (!isRecord(value)) throw invalidInput()
  const text = readString(value.text)
  if (text === null) throw invalidInput()
  const attachments = value.attachments
  if (attachments !== undefined) {
    if (!Array.isArray(attachments) || !attachments.every((item) => readString(item) !== null)) {
      throw invalidInput()
    }
  }
  return {
    text,
    ...(attachments === undefined ? {} : { attachments: [...attachments] as string[] }),
  }
}

/** 解析 session.respondPermission 输入；updatedPermissions 的形状由 PermissionBroker 校验。 */
export function readPermissionAnswer(value: unknown): PermissionAnswer {
  if (!isRecord(value)) throw invalidInput()
  const requestId = readString(value.requestId)
  const decision = value.decision
  if (requestId === null || (decision !== "allow" && decision !== "deny")) {
    throw invalidInput()
  }
  const updatedPermissions =
    value.updatedPermissions === undefined
      ? undefined
      : readPermissionUpdates(value.updatedPermissions)
  return {
    requestId,
    decision,
    ...(updatedPermissions === undefined ? {} : { updatedPermissions }),
  }
}

/** 解析四档权限模式。 */
export function readPermissionMode(value: unknown): SessionPermissionMode {
  if (typeof value !== "string" || !permissionModes.has(value as SessionPermissionMode)) {
    throw invalidInput()
  }
  return value as SessionPermissionMode
}

/** 解析 usage.summary 的时间范围。 */
export function readUsageRange(value: unknown): UsageRange {
  if (!isRecord(value) || (value.range !== "today" && value.range !== "7d")) {
    throw invalidInput()
  }
  return value.range
}

// 权限更新来自 renderer，先限制条数、形状和序列化大小，避免超大对象进入权限代理。
function readPermissionUpdates(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalidInput()
  if (value.length > maxUpdatedPermissions) throw invalidInput()
  if (!value.every((item) => isRecord(item))) throw invalidInput()
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw invalidInput()
  }
  if (serialized.length > maxUpdatedPermissionsBytes) throw invalidInput()
  return value
}

function readModel(value: unknown): string {
  const model = readString(value)
  if (model === null) throw invalidInput()
  return model
}

function assertTrusted(options: SessionIpcOptions, event: IpcMainInvokeEvent): void {
  if (!options.isTrusted(event)) throw new Error("UNTRUSTED_SESSION_REQUEST")
}

function requireHost(options: SessionIpcOptions): SessionHost {
  const host = options.getHost()
  if (host === null) throw new SessionHostError("SDK_ERROR", "会话服务尚未准备好")
  return host
}

function invalidInput(): Error {
  return new Error("INVALID_SESSION_INPUT")
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
