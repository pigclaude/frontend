// 定义会话索引的字段和格式版本，并负责把磁盘上的原始对象解析成索引、把索引写回原始对象。
// 写回只覆盖认识的字段，不认识的字段原样保留。索引里没有代理地址、令牌或密码字段。

import type { SessionEffort, SessionPermissionMode, SessionThinking } from "./session-events"
import { isPlainRecord } from "./session-store-guards"
import type { SessionTurnEndStatus } from "./session-types"

/** 本版本写出的索引格式版本；读到更新的版本时不解析、不改写。 */
export const sessionIndexVersion = 1

/** 会话状态：运行中、停放、中断（有进行中的回合时被打断）、失败。 */
export type SessionStoreStatus = "running" | "parked" | "interrupted" | "failed"

/** 标题来源：自动生成，或用户改过（改过的不再被自动标题覆盖）。 */
export type SessionTitleSource = "auto" | "user"

/** 会话来源：手动开始，或定时任务创建。 */
export type SessionOrigin = "manual" | "scheduled"

/** 权限档；计划模式单独用 planMode 记录。 */
export type SessionPermissionLevel = Exclude<SessionPermissionMode, "plan">

/** 最后一轮怎样结束；errorCode 与 turn-ended 的错误码一致，正常结束时为 null。 */
export type SessionLastTurn = { status: SessionTurnEndStatus; errorCode: string | null }

/** 会话环境快照：续接时按它选同环境的账号。不含代理地址或任何凭据。 */
export type SessionEnvironmentSnapshot = {
  browserProfileId: string | null
  /** 浏览器实例配置的 revision；配置版本变了但时区和语言没变时仍可续接。 */
  browserProfileRevision: number | null
  timezone: string
  locale: string
}

/** 一个会话的索引。时间都是 ISO UTC 字符串。 */
export type SessionIndex = {
  id: string
  title: string
  titleSource: SessionTitleSource
  projectPath: string
  createdAt: string
  updatedAt: string
  lastActivityAt: string
  archivedAt: string | null
  status: SessionStoreStatus
  lastTurn: SessionLastTurn | null
  environment: SessionEnvironmentSnapshot
  preferredAccountId: string | null
  activeAccountId: string | null
  model: string | null
  thinking: SessionThinking | null
  effort: SessionEffort | null
  fast: boolean
  permissionMode: SessionPermissionLevel
  planMode: boolean
  origin: SessionOrigin
  claudeCodeVersion: string | null
  referencedSessionIds: string[]
  /** 时间线里已写入的最大序号；还没有事件时为 0。 */
  timelineCursor: number
}

/** 解析结果：认识的索引连同原始对象，或者版本更新、格式不对的原因。 */
export type ParsedSessionIndex =
  | { kind: "ok"; index: SessionIndex; raw: Record<string, unknown> }
  | { kind: "newer"; version: number }
  | { kind: "invalid"; reason: string }

const statuses: readonly SessionStoreStatus[] = ["running", "parked", "interrupted", "failed"]
const titleSources: readonly SessionTitleSource[] = ["auto", "user"]
const origins: readonly SessionOrigin[] = ["manual", "scheduled"]
const turnStatuses: readonly SessionTurnEndStatus[] = ["completed", "error", "interrupted"]
const thinkings: readonly SessionThinking[] = ["off", "low", "medium", "high"]
const efforts: readonly SessionEffort[] = ["low", "medium", "high", "xhigh", "max"]
const levels: readonly SessionPermissionLevel[] = [
  "default",
  "acceptEdits",
  "auto",
  "bypassPermissions",
]

/** 解析磁盘上的索引对象；任何认识的字段类型不对都判为格式不对，不猜默认值。 */
export function parseSessionIndex(value: unknown): ParsedSessionIndex {
  if (!isPlainRecord(value)) return { kind: "invalid", reason: "not an object" }
  const version = value.version
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1)
    return { kind: "invalid", reason: "missing version" }
  if (version > sessionIndexVersion) return { kind: "newer", version }
  const environment = parseEnvironment(value.environment)
  const lastTurn = parseLastTurn(value.lastTurn)
  const referenced = value.referencedSessionIds
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !oneOf(value.titleSource, titleSources) ||
    typeof value.projectPath !== "string" ||
    !isTime(value.createdAt) ||
    !isTime(value.updatedAt) ||
    !isTime(value.lastActivityAt) ||
    (value.archivedAt !== null && !isTime(value.archivedAt)) ||
    !oneOf(value.status, statuses) ||
    lastTurn === undefined ||
    environment === null ||
    !isNullableString(value.preferredAccountId) ||
    !isNullableString(value.activeAccountId) ||
    !isNullableString(value.model) ||
    (value.thinking !== null && !oneOf(value.thinking, thinkings)) ||
    (value.effort !== null && !oneOf(value.effort, efforts)) ||
    typeof value.fast !== "boolean" ||
    !oneOf(value.permissionMode, levels) ||
    typeof value.planMode !== "boolean" ||
    !oneOf(value.origin, origins) ||
    !isNullableString(value.claudeCodeVersion) ||
    !Array.isArray(referenced) ||
    !referenced.every((id) => typeof id === "string") ||
    !isCount(value.timelineCursor)
  )
    return { kind: "invalid", reason: "field has wrong type" }
  return {
    kind: "ok",
    raw: value,
    index: {
      id: value.id,
      title: value.title,
      titleSource: value.titleSource,
      projectPath: value.projectPath,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      lastActivityAt: value.lastActivityAt,
      archivedAt: value.archivedAt,
      status: value.status,
      lastTurn,
      environment,
      preferredAccountId: value.preferredAccountId,
      activeAccountId: value.activeAccountId,
      model: value.model,
      thinking: value.thinking,
      effort: value.effort,
      fast: value.fast,
      permissionMode: value.permissionMode,
      planMode: value.planMode,
      origin: value.origin,
      claudeCodeVersion: value.claudeCodeVersion,
      referencedSessionIds: [...referenced],
      timelineCursor: value.timelineCursor,
    },
  }
}

/** 把索引写回原始对象：认识的字段和格式版本用索引的值，其余字段保持原样。 */
export function sessionIndexRecord(
  raw: Readonly<Record<string, unknown>>,
  index: SessionIndex,
): Record<string, unknown> {
  return { ...raw, ...index, version: sessionIndexVersion }
}

function parseEnvironment(value: unknown): SessionEnvironmentSnapshot | null {
  if (!isPlainRecord(value)) return null
  const revision = value.browserProfileRevision
  if (
    !isNullableString(value.browserProfileId) ||
    (revision !== null && !isCount(revision)) ||
    typeof value.timezone !== "string" ||
    typeof value.locale !== "string"
  )
    return null
  return {
    browserProfileId: value.browserProfileId,
    browserProfileRevision: revision,
    timezone: value.timezone,
    locale: value.locale,
  }
}

function parseLastTurn(value: unknown): SessionLastTurn | null | undefined {
  if (value === null) return null
  if (
    !isPlainRecord(value) ||
    !oneOf(value.status, turnStatuses) ||
    !isNullableString(value.errorCode)
  )
    return undefined
  return { status: value.status, errorCode: value.errorCode }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}
