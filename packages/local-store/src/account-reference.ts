// 定义账号引用持久化模型，运行时环境只从关联浏览器配置解引用。

import { isClaudeCredential, type ClaudeCredential } from "./credential"
import { parseAccountRecord, type AccountRecord } from "./schema"

/** v4 账号只持有实例引用，没有可独立修改的指纹、代理或浏览器目录副本。 */
export type AccountReference = {
  schemaVersion: 4
  id: string
  displayName: string
  enabled: boolean
  credential: ClaudeCredential | null
  needsReauth: boolean
  browserProfileId: string
  exhaustedUntil: string | null
  createdAt: string
  updatedAt: string
}

/** 迁移读取接受旧账号，磁盘 v4 与解引用视图区分。 */
export type StoredAccount = AccountReference | AccountRecord

/** 解析 v4 引用或兼容旧格式；未知版本由存储层原样保留。 */
export function parseStoredAccount(value: unknown): StoredAccount | null {
  if (!record(value) || value.schemaVersion !== 4) return parseAccountRecord(value)
  if (
    typeof value.id !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.enabled !== "boolean" ||
    (value.credential !== null && !isClaudeCredential(value.credential)) ||
    typeof value.needsReauth !== "boolean" ||
    typeof value.browserProfileId !== "string" ||
    !value.browserProfileId ||
    (value.exhaustedUntil !== null && typeof value.exhaustedUntil !== "string") ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    return null
  return {
    schemaVersion: 4,
    id: value.id,
    displayName: value.displayName,
    enabled: value.enabled,
    credential: value.credential,
    needsReauth: value.needsReauth,
    browserProfileId: value.browserProfileId,
    exhaustedUntil: value.exhaustedUntil,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

/** 明确挑选账号字段，解引用环境和目录不得再次落盘为账号副本。 */
export function toAccountReference(
  account: StoredAccount,
  browserProfileId: string,
): AccountReference {
  return {
    schemaVersion: 4,
    id: account.id,
    displayName: account.displayName,
    enabled: account.enabled,
    credential: account.credential,
    needsReauth: account.needsReauth,
    browserProfileId,
    exhaustedUntil: account.exhaustedUntil,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
