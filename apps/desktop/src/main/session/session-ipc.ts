// 负责注册 session.* 和只读 usage.summary 的 IPC；所有 renderer 输入在 main 侧校验后再交给 SessionHost。

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import { isAbsolute } from "node:path"
import type { SessionHost } from "./session-host"
import {
  SessionHostError,
  type PermissionAnswer,
  type QuestionAnswer,
  type SessionEffort,
  type SessionEventsInput,
  type SessionPermissionMode,
  type SessionReference,
  type SessionSendInput,
  type SessionStartInput,
  type SessionTarget,
  type SessionThinking,
  type SessionTools,
  type UsageRange,
  isSessionReference,
} from "./session-types"
import type { UsageRecorder } from "./usage-recorder"
import { isSessionStoreId } from "./session-store-layout"
import { registerSessionHistoryIpc } from "./session-history-ipc"
import { captureSessionCheckpoint } from "../workbench/session-checkpoints"
import { readCommandCatalog } from "./session-command-catalogs"

const permissionModes = new Set<SessionPermissionMode>([
  "default",
  "acceptEdits",
  "auto",
  "plan",
  "bypassPermissions",
])
const thinkingLevels = new Set<SessionThinking>(["off", "low", "medium", "high"])
const effortLevels = new Set<SessionEffort>(["low", "medium", "high", "xhigh", "max"])
const maxUpdatedPermissions = 50
const maxUpdatedPermissionsBytes = 64 * 1024
const maxSessionIdLength = 200
const maxRequestIdLength = 200
const maxQuestionAnswers = 16
const maxQuestionAnswerLength = 8 * 1024

/** 会话 IPC 依赖；host 和用量记录器可能在窗口创建后仍未装配。 */
export type SessionIpcOptions = {
  getHost: () => SessionHost | null
  getUsage: () => Pick<UsageRecorder, "summary"> | null
  isTrusted: (event: IpcMainInvokeEvent) => boolean
  /** 为一次启动建会话专用的工具；会话停放时由宿主关掉。 */
  tools?: (event: IpcMainInvokeEvent) => SessionTools
}

/** 注册会话命令、列出会话、按序号补拉事件和只读用量汇总。保证所有命令只接受主窗口当前 frame，命令都指明会话。 */
export function registerSessionIpc(options: SessionIpcOptions): void {
  ipcMain.handle("pigclaude:session-commands", async (event, value: unknown) => {
    assertTrusted(options, event)
    const workspace = fieldOf(value, "workspace")
    if (
      typeof workspace !== "string" ||
      workspace.length > 4096 ||
      workspace.includes("\0") ||
      !isAbsolute(workspace)
    ) {
      throw new SessionHostError("WORKSPACE_UNAVAILABLE", "工作区必须是绝对路径")
    }
    const sessionId =
      fieldOf(value, "sessionId") === undefined ? undefined : readSessionTarget(value).sessionId
    return readCommandCatalog(options.getHost(), workspace, sessionId).catch(() => {
      throw new SessionHostError("WORKSPACE_UNAVAILABLE", "无法读取项目命令")
    })
  })
  ipcMain.handle("pigclaude:session-start", async (event, value: unknown) => {
    assertTrusted(options, event)
    const input = readSessionStartInput(value)
    return options.tools
      ? requireHost(options).start(input, options.tools(event))
      : requireHost(options).start(input)
  })
  ipcMain.handle("pigclaude:session-send", async (event, value: unknown) => {
    assertTrusted(options, event)
    const { sessionId } = readSessionTarget(value)
    const workbench = options.tools
    await requireHost(options).send(
      sessionId,
      readSessionSendInput(value),
      (workspace, phase, turnId) =>
        captureSessionCheckpoint(event.sender, workspace, phase, { sessionId, turnId }),
      ...(workbench === undefined ? [] : [() => workbench(event)]),
    )
  })
  ipcMain.handle("pigclaude:session-cancel", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireHost(options).cancel(readSessionTarget(value).sessionId)
  })
  ipcMain.handle("pigclaude:session-respond-permission", async (event, value: unknown) => {
    assertTrusted(options, event)
    const { sessionId } = readSessionTarget(value)
    await requireHost(options).respondPermission(sessionId, readPermissionAnswer(value))
  })
  ipcMain.handle("pigclaude:session-answer-question", async (event, value: unknown) => {
    assertTrusted(options, event)
    const { sessionId } = readSessionTarget(value)
    requireHost(options).answerQuestion(sessionId, readQuestionAnswer(value))
  })
  ipcMain.handle("pigclaude:session-set-mode", async (event, value: unknown) => {
    assertTrusted(options, event)
    const { sessionId } = readSessionTarget(value)
    await requireHost(options).setMode(sessionId, readPermissionMode(fieldOf(value, "mode")))
  })
  ipcMain.handle("pigclaude:session-set-model", async (event, value: unknown) => {
    assertTrusted(options, event)
    const { sessionId } = readSessionTarget(value)
    await requireHost(options).setModel(sessionId, readModel(fieldOf(value, "model")))
  })
  ipcMain.handle("pigclaude:session-stop", async (event, value: unknown) => {
    assertTrusted(options, event)
    await requireHost(options).stop(readSessionTarget(value).sessionId)
  })
  ipcMain.handle("pigclaude:session-events", async (event, value: unknown) => {
    assertTrusted(options, event)
    const input = readSessionEventsInput(value)
    return requireHost(options).historyEvents(input.sessionId, input.afterSeq)
  })
  ipcMain.handle("pigclaude:session-models", async (event) => {
    assertTrusted(options, event)
    return requireHost(options).models()
  })
  ipcMain.handle("pigclaude:session-status", async (event, value: unknown) => {
    assertTrusted(options, event)
    const host = requireHost(options)
    await host.ready()
    return value === undefined ? host.status() : host.status(readSessionTarget(value).sessionId)
  })
  registerSessionHistoryIpc(ipcMain, (event) => {
    assertTrusted(options, event)
    return requireHost(options)
  })
  ipcMain.handle("pigclaude:usage-summary", async (event, value: unknown) => {
    assertTrusted(options, event)
    const usage = options.getUsage()
    if (usage === null) throw new SessionHostError("SDK_ERROR", "用量记录尚未准备好")
    return usage.summary(readUsageRange(value))
  })
}

/** 解析 session.start 输入；拒绝非对象、相对工作区、未知模式、空模型和不能当目录名的会话 id。 */
export function readSessionStartInput(value: unknown): SessionStartInput {
  if (!isRecord(value)) throw invalidInput()
  const sessionId = value.sessionId
  if (sessionId !== undefined && (typeof sessionId !== "string" || !isSessionStoreId(sessionId))) {
    throw invalidInput()
  }
  const workspace = readString(value.workspace)
  const projectPath = readOptionalString(value.projectPath)
  if (projectPath !== undefined && !isAbsolute(projectPath)) throw invalidInput()
  const permissionMode = readPermissionMode(value.permissionMode)
  const model = readOptionalString(value.model)
  const accountId = readOptionalString(value.accountId)
  const thinking = value.thinking
  if (thinking !== undefined && !thinkingLevels.has(thinking as SessionThinking)) {
    throw invalidInput()
  }
  const effort = readOptionalEffort(value.effort)
  const fast = readOptionalFast(value.fast)
  if (workspace === null) throw invalidInput()
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    workspace,
    ...(projectPath === undefined ? {} : { projectPath }),
    permissionMode,
    ...(model === undefined ? {} : { model }),
    ...(accountId === undefined ? {} : { accountId }),
    ...(thinking === undefined ? {} : { thinking: thinking as SessionThinking }),
    ...(effort === undefined ? {} : { effort }),
    ...(fast === undefined ? {} : { fast }),
  }
}

/** 解析会话命令指向的会话；会话 id 必须是不超长的非空字符串。 */
export function readSessionTarget(value: unknown): SessionTarget {
  const sessionId = readString(fieldOf(value, "sessionId"))
  if (sessionId === null || sessionId.length > maxSessionIdLength) throw invalidInput()
  return { sessionId }
}

/** 解析按序号补拉事件的输入；afterSeq 是不小于 0 的安全整数。 */
export function readSessionEventsInput(value: unknown): SessionEventsInput {
  const { sessionId } = readSessionTarget(value)
  const afterSeq = fieldOf(value, "afterSeq")
  if (typeof afterSeq !== "number" || !Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw invalidInput()
  }
  return { sessionId, afterSeq }
}

/** 解析 session.send 输入；始终保留显式关闭快速模式与恢复默认思考深度的设置。 */
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
  const effort = value.effort === null ? null : readOptionalEffort(value.effort)
  const fast = readOptionalFast(value.fast)
  const references = readReferences(value.references)
  return {
    text,
    ...(attachments === undefined ? {} : { attachments: [...attachments] as string[] }),
    ...(effort === undefined ? {} : { effort }),
    ...(fast === undefined ? {} : { fast }),
    ...(references === undefined ? {} : { references }),
  }
}

function readReferences(value: unknown): SessionReference[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw invalidInput()
  return value.map((item: unknown) => {
    if (!isSessionReference(item) || item.threadId.length > maxSessionIdLength) {
      throw invalidInput()
    }
    return { kind: "thread", threadId: item.threadId, title: item.title }
  })
}

function readOptionalEffort(value: unknown): SessionEffort | undefined {
  if (value === undefined) return undefined
  if (!effortLevels.has(value as SessionEffort)) throw invalidInput()
  return value as SessionEffort
}

function readOptionalFast(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === "boolean") return value
  throw invalidInput()
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

/**
 * 解析 session.answerQuestion 输入：每个问题一条答案，最多 16 条，每条不超过 8 KiB 字符；
 * 条数是否和问题数一致由提问代理核对。
 */
export function readQuestionAnswer(value: unknown): QuestionAnswer {
  if (!isRecord(value)) throw invalidInput()
  const requestId = readString(value.requestId)
  if (requestId === null || requestId.length > maxRequestIdLength) throw invalidInput()
  const answers = value.answers
  if (!Array.isArray(answers) || answers.length === 0 || answers.length > maxQuestionAnswers) {
    throw invalidInput()
  }
  if (
    !answers.every(
      (answer) => typeof answer === "string" && answer.length <= maxQuestionAnswerLength,
    )
  ) {
    throw invalidInput()
  }
  return { requestId, answers: [...answers] as string[] }
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

function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
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
