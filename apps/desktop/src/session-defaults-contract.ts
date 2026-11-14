// 定义新会话默认设置在主进程、preload 和页面之间的形状和校验：默认模型、默认权限档位和选号偏好。

/** 能作为默认值的权限档位：计划是独立开关，不作为默认。 */
export type DefaultPermissionMode = "default" | "acceptEdits" | "auto" | "bypassPermissions"

/**
 * 新会话的默认设置。model 为 null 时跟随 Claude Code 的默认模型；
 * accountId 为 null 时自动选择账号，否则优先这个账号，不可用时按切换规则换号。
 */
export type SessionDefaults = {
  model: string | null
  permissionMode: DefaultPermissionMode
  accountId: string | null
}

/** 一次修改；没给的项保持原值。 */
export type SessionDefaultsPatch = Partial<SessionDefaults>

/** 没有设置过时的默认值：Claude Code 默认模型、监督审批、自动选择账号。 */
export const builtinSessionDefaults: SessionDefaults = {
  model: null,
  permissionMode: "default",
  accountId: null,
}

const permissionModes: ReadonlySet<string> = new Set<DefaultPermissionMode>([
  "default",
  "acceptEdits",
  "auto",
  "bypassPermissions",
])

const maxModelLength = 200
const maxAccountIdLength = 128

/**
 * 校验页面发来的修改。只接受 model、permissionMode、accountId 三项；模型和账号是不含控制字符的
 * 非空字符串或 null，权限只能是四个档位之一。不合法时抛 SESSION_DEFAULTS_INVALID。
 */
export function readSessionDefaultsPatch(value: unknown): SessionDefaultsPatch {
  if (!isRecord(value)) throw invalid()
  const patch: SessionDefaultsPatch = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === "model" && isNullableId(item, maxModelLength)) patch.model = item
    else if (key === "accountId" && isNullableId(item, maxAccountIdLength)) patch.accountId = item
    else if (key === "permissionMode" && isDefaultPermissionMode(item)) patch.permissionMode = item
    else throw invalid()
  }
  return patch
}

/** 从存储读出的内容整理成完整设置：不合法的项换成内置默认，从不抛错。 */
export function normalizeSessionDefaults(value: unknown): SessionDefaults {
  const stored = isRecord(value) ? value : {}
  return {
    model: isNullableId(stored.model, maxModelLength) ? stored.model : builtinSessionDefaults.model,
    permissionMode: isDefaultPermissionMode(stored.permissionMode)
      ? stored.permissionMode
      : builtinSessionDefaults.permissionMode,
    accountId: isNullableId(stored.accountId, maxAccountIdLength)
      ? stored.accountId
      : builtinSessionDefaults.accountId,
  }
}

/** 是否是一份完整且合法的设置；preload 用它检查主进程的回复。 */
export function isSessionDefaults(value: unknown): value is SessionDefaults {
  return (
    isRecord(value) &&
    isNullableId(value.model, maxModelLength) &&
    isDefaultPermissionMode(value.permissionMode) &&
    isNullableId(value.accountId, maxAccountIdLength)
  )
}

/** 是否是能作为默认值的权限档位。 */
export function isDefaultPermissionMode(value: unknown): value is DefaultPermissionMode {
  return typeof value === "string" && permissionModes.has(value)
}

function isNullableId(value: unknown, maxLength: number): value is string | null {
  if (value === null) return true
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= maxLength &&
    !/\p{Cc}/u.test(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalid(): Error {
  return new Error("SESSION_DEFAULTS_INVALID")
}
