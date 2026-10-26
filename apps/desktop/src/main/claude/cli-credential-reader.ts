// 负责在 macOS 上只读 Claude CLI 的 Keychain 凭据，并且只返回 claudeAiOauth 白名单字段。

import { execFile as nodeExecFile } from "node:child_process"
import { createHash } from "node:crypto"
import { userInfo } from "node:os"
import { resolveClaudeCliConfigDir } from "./cli-config-dir"
import { ClaudeAccountError } from "./errors"

const defaultKeychainService = "Claude Code-credentials"
const securityPath = "/usr/bin/security"
const commandTimeoutMs = 60_000
const commandMaxBuffer = 1024 * 1024
// Claude Code 只接受这些字符作为 Keychain 账号名；不合法时使用固定回退名。
const userPattern = /^[a-zA-Z0-9._-]+$/
const fallbackUser = "claude-code-user"

const messages = {
  notFound: "未找到 Claude CLI 凭据，请先在 Claude CLI 中登录",
  denied: "无法读取 Claude CLI 凭据，请允许访问钥匙串后重试",
  timeout: "读取钥匙串超时，请重试并允许访问",
  locked: "钥匙串已锁定，请解锁后重试",
  invalid: "Claude CLI 凭据格式无效",
  tooLarge: "Claude CLI 凭据过大，无法读取",
  expired: "Claude CLI 凭据已过期，请先在 Claude CLI 中刷新",
  unsupported: "仅支持在 macOS 上从 Claude CLI 导入账号",
} as const

/** 固定只读命令的执行选项。保证不启用 shell，并限制运行时间和输出大小。 */
export type ClaudeCliExecFileOptions = {
  encoding: "utf8"
  timeout: number
  maxBuffer: number
  windowsHide: boolean
  shell: false
}

/** 可替换的 execFile 边界，测试用它避免访问真实 Keychain。 */
export type ClaudeCliExecFile = (
  file: string,
  args: string[],
  options: ClaudeCliExecFileOptions,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void

/** Keychain 读取的可注入依赖。configDir 显式传入 null 时忽略环境变量。 */
export type ClaudeCliCredentialReaderOptions = {
  platform?: string
  user?: string
  env?: NodeJS.ProcessEnv
  configDir?: string | null
  now?: () => number
  execFile?: ClaudeCliExecFile
}

/** 从 Claude CLI 凭据中提取的白名单字段。保证不含 mcpOAuth 或其他扩展字段。 */
export type ClaudeCliCredential = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  refreshTokenExpiresAt: number | null
  scopes: string[]
  subscriptionType: string | null
  rateLimitTier: string | null
}

/** 计算 Claude CLI 在 macOS Keychain 中使用的 service 名。configDir 为空时使用无后缀默认项。 */
export function claudeCliKeychainService(configDir?: string | null): string {
  if (configDir === undefined || configDir === null || configDir === "") {
    return defaultKeychainService
  }
  const suffix = createHash("sha256")
    .update(configDir.normalize("NFC"), "utf8")
    .digest("hex")
    .slice(0, 8)
  return `${defaultKeychainService}-${suffix}`
}

/** 读取 Claude CLI 凭据。保证只在 macOS 执行固定 security 命令，并返回不含原始输出的白名单字段。 */
export async function readClaudeCliCredential(
  options: ClaudeCliCredentialReaderOptions = {},
): Promise<ClaudeCliCredential> {
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new ClaudeAccountError("CLI_IMPORT_UNSUPPORTED_PLATFORM", messages.unsupported)
  }
  const env = options.env ?? process.env
  const configDir = resolveClaudeCliConfigDir({ configDir: options.configDir, env })
  const service = claudeCliKeychainService(configDir)
  let user: string
  try {
    user = resolveUser(options, env)
  } catch {
    throw new ClaudeAccountError("CLI_KEYCHAIN_DENIED", messages.denied)
  }
  const execFile = options.execFile ?? defaultExecFile
  const stdout = await readKeychainValue(execFile, user, service)
  const credential = readClaudeAiOauth(parsePayload(stdout))
  assertNotExpired(credential, (options.now ?? Date.now)())
  return credential
}

const defaultExecFile: ClaudeCliExecFile = (file, args, options, callback) => {
  nodeExecFile(file, args, options, callback)
}

function resolveUser(options: ClaudeCliCredentialReaderOptions, env: NodeJS.ProcessEnv): string {
  const candidate =
    options.user !== undefined && options.user !== ""
      ? options.user
      : env.USER !== undefined && env.USER !== ""
        ? env.USER
        : userInfo().username
  return userPattern.test(candidate) ? candidate : fallbackUser
}

function readKeychainValue(
  execFile: ClaudeCliExecFile,
  user: string,
  service: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        securityPath,
        ["find-generic-password", "-a", user, "-w", "-s", service],
        {
          encoding: "utf8",
          timeout: commandTimeoutMs,
          maxBuffer: commandMaxBuffer,
          windowsHide: true,
          shell: false,
        },
        (error, stdout) => {
          if (error === null) resolve(stdout)
          else reject(keychainError(error))
        },
      )
    } catch {
      reject(new ClaudeAccountError("CLI_KEYCHAIN_DENIED", messages.denied))
    }
  })
}

// 只保留退出码或错误类型，不把 security 的 stdout、stderr 或原始错误挂到新错误上。
function keychainError(error: Error): ClaudeAccountError {
  const code = readErrorCode(error)
  if (code === 44) {
    return new ClaudeAccountError("CLI_CREDENTIAL_NOT_FOUND", messages.notFound)
  }
  if (code === 36) {
    return new ClaudeAccountError("CLI_KEYCHAIN_LOCKED", messages.locked)
  }
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new ClaudeAccountError("CLI_CREDENTIAL_INVALID", messages.tooLarge)
  }
  if (isTimeout(error, code)) {
    return new ClaudeAccountError("CLI_KEYCHAIN_DENIED", messages.timeout)
  }
  return new ClaudeAccountError("CLI_KEYCHAIN_DENIED", messages.denied)
}

function readErrorCode(error: Error): string | number | null {
  const code = (error as { code?: unknown }).code
  return typeof code === "string" || typeof code === "number" ? code : null
}

function isTimeout(error: Error, code: string | number | null): boolean {
  if (code === "ETIMEDOUT") return true
  const killed = (error as { killed?: unknown }).killed
  const signal = (error as { signal?: unknown }).signal
  return killed === true || signal === "SIGTERM"
}

function parsePayload(stdout: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(stdout.trim())
  } catch {
    throw invalidCredential()
  }
  if (!isRecord(value)) throw invalidCredential()
  return value
}

function readClaudeAiOauth(payload: Record<string, unknown>): ClaudeCliCredential {
  const oauth = payload.claudeAiOauth
  if (!isRecord(oauth)) throw invalidCredential()
  const accessToken = readNonEmptyString(oauth.accessToken)
  const refreshToken = readNonEmptyString(oauth.refreshToken)
  if (accessToken === null || refreshToken === null) throw invalidCredential()
  if (typeof oauth.expiresAt !== "number" || !Number.isFinite(oauth.expiresAt)) {
    throw invalidCredential()
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: oauth.expiresAt,
    refreshTokenExpiresAt: readOptionalTimestamp(oauth.refreshTokenExpiresAt),
    scopes: readScopes(oauth.scopes),
    subscriptionType: readOptionalString(oauth.subscriptionType),
    rateLimitTier: readOptionalString(oauth.rateLimitTier),
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function readOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw invalidCredential()
  return value === "" ? null : value
}

function readOptionalTimestamp(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalidCredential()
  return value
}

function readScopes(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((scope) => typeof scope === "string")) {
    throw invalidCredential()
  }
  return [...value]
}

function assertNotExpired(credential: ClaudeCliCredential, now: number): void {
  if (credential.refreshTokenExpiresAt !== null && credential.refreshTokenExpiresAt <= now) {
    throw expiredCredential()
  }
  if (credential.expiresAt <= now) throw expiredCredential()
}

function invalidCredential(): ClaudeAccountError {
  return new ClaudeAccountError("CLI_CREDENTIAL_INVALID", messages.invalid)
}

function expiredCredential(): ClaudeAccountError {
  return new ClaudeAccountError("CLI_CREDENTIAL_EXPIRED", messages.expired)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
