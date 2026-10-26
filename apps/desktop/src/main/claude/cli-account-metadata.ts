// 负责只读 Claude CLI 的 ~/.claude.json 账号元数据，并且只返回 oauthAccount 白名单字段。

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { resolveClaudeCliConfigDir } from "./cli-config-dir"

const metadataFileName = ".claude.json"

/** 从 Claude CLI 配置中提取的账号展示信息。保证不含 token 或未列入白名单的字段。 */
export type ClaudeCliAccountMetadata = {
  accountUuid: string | null
  emailAddress: string | null
  displayName: string | null
  fullName: string | null
  organizationUuid: string | null
  organizationName: string | null
  organizationType: string | null
  organizationRateLimitTier: string | null
}

/** 元数据读取的可注入依赖。configDir 显式传入 null 时忽略环境变量。 */
export type ClaudeCliAccountMetadataOptions = {
  homeDir?: string
  env?: NodeJS.ProcessEnv
  configDir?: string | null
  readFile?: (path: string) => Promise<string>
}

/** 读取 Claude CLI 账号元数据。保证文件缺失或 JSON 非法时返回 null，不阻断导入。 */
export async function readClaudeCliAccountMetadata(
  options: ClaudeCliAccountMetadataOptions = {},
): Promise<ClaudeCliAccountMetadata | null> {
  const path = metadataPath(options)
  if (path === null) return null
  let content: string
  try {
    content = await (options.readFile ?? readFileUtf8)(path)
  } catch {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return null
  }
  if (!isRecord(value) || !isRecord(value.oauthAccount)) return null
  const account = value.oauthAccount
  return {
    accountUuid: readString(account.accountUuid),
    emailAddress: readString(account.emailAddress),
    displayName: readString(account.displayName),
    fullName: readString(account.fullName),
    organizationUuid: readString(account.organizationUuid),
    organizationName: readString(account.organizationName),
    organizationType: readString(account.organizationType),
    organizationRateLimitTier: readString(account.organizationRateLimitTier),
  }
}

function metadataPath(options: ClaudeCliAccountMetadataOptions): string | null {
  const configDir = resolveClaudeCliConfigDir(options)
  if (configDir !== null) return join(configDir, metadataFileName)
  try {
    return join(options.homeDir ?? homedir(), metadataFileName)
  } catch {
    return null
  }
}

function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8")
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
