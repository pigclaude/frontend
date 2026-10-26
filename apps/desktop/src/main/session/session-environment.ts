// 负责为一个会话创建隔离的配置目录、环境变量和 Intl 预加载文件；不读用户设置，不保存真实凭据。

import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { buildSessionEnv } from "@pigclaude/session-env"

/** 会话环境里的非秘密占位 token；真实 access token 只留在 daemon 内。 */
export const placeholderOAuthToken = "pigclaude-local"

/** 本机会话使用的 NO_PROXY 值，保证回环请求不经过账号代理。 */
export const localNoProxy = "127.0.0.1,localhost"

const sessionDirectoryMode = 0o700
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const sessionTokenPattern = /^[A-Za-z0-9_-]+$/

/** 创建会话环境的输入。userDataPath 可省略，Electron 环境会读取 app.getPath("userData")。 */
export type SessionEnvironmentInput = {
  sessionId: string
  workspace: string
  daemonBaseUrl: string
  sessionToken: string
  timezone: string
  locale: string
  binaryPath: string
  userDataPath?: string
}

/** 一次会话的环境和目录。cleanup 删除整个 sessions/<sessionId>，可重复调用。 */
export class SessionEnvironment {
  readonly env: Record<string, string>
  readonly configDir: string
  readonly sessionDir: string
  readonly workspace: string
  readonly binaryPath: string
  #cleaned = false

  private constructor(input: {
    env: Record<string, string>
    configDir: string
    sessionDir: string
    workspace: string
    binaryPath: string
  }) {
    this.env = input.env
    this.configDir = input.configDir
    this.sessionDir = input.sessionDir
    this.workspace = input.workspace
    this.binaryPath = input.binaryPath
  }

  /** 创建 0700 的会话目录、配置目录和 Intl 预加载，并返回本次会话的环境；失败时删除已创建的目录。 */
  static async create(input: SessionEnvironmentInput): Promise<SessionEnvironment> {
    assertSessionId(input.sessionId)
    assertSessionToken(input.sessionToken)
    if (!isAbsolute(input.workspace)) throw new Error("workspace must be an absolute path")
    const userDataPath = input.userDataPath ?? (await defaultUserDataPath())
    const sessionsDir = join(userDataPath, "sessions")
    const sessionDir = join(sessionsDir, input.sessionId)
    const configDir = join(sessionDir, "claude")
    const preloadPath = join(sessionDir, "intl-preload.cjs")
    const env = buildEnvironment(input, configDir, preloadPath)
    const preloadSource = buildSessionEnv({
      daemonBaseUrl: input.daemonBaseUrl,
      timezone: input.timezone,
      locale: input.locale,
      userSettingsEnv: {},
    }).preloadSource

    let created = false
    try {
      await mkdir(sessionsDir, { recursive: true, mode: sessionDirectoryMode })
      await mkdir(sessionDir, { mode: sessionDirectoryMode })
      created = true
      await mkdir(configDir, { mode: sessionDirectoryMode })
      await writeFile(preloadPath, preloadSource, { mode: sessionDirectoryMode })
      await chmod(sessionsDir, sessionDirectoryMode)
      await chmod(sessionDir, sessionDirectoryMode)
      await chmod(configDir, sessionDirectoryMode)
      await chmod(preloadPath, sessionDirectoryMode)
    } catch (error) {
      if (created) await rm(sessionDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }

    return new SessionEnvironment({
      env,
      configDir,
      sessionDir,
      workspace: input.workspace,
      binaryPath: input.binaryPath,
    })
  }

  /** 删除整个会话目录。保证重复调用安全，且不会删除 sessions 父目录。 */
  async cleanup(): Promise<void> {
    if (this.#cleaned) return
    await rm(this.sessionDir, { recursive: true, force: true })
    this.#cleaned = true
  }
}

function buildEnvironment(
  input: SessionEnvironmentInput,
  configDir: string,
  preloadPath: string,
): Record<string, string> {
  const { env } = buildSessionEnv({
    daemonBaseUrl: input.daemonBaseUrl,
    timezone: input.timezone,
    locale: input.locale,
    userSettingsEnv: {},
  })
  env.CLAUDE_CODE_OAUTH_TOKEN = placeholderOAuthToken
  env.CLAUDE_CONFIG_DIR = configDir
  env.NODE_OPTIONS = `--require ${JSON.stringify(preloadPath)}`
  env.NO_PROXY = localNoProxy
  env.no_proxy = localNoProxy
  env.ANTHROPIC_CUSTOM_HEADERS = `x-pigclaude-session: ${input.sessionToken}`
  return env
}

function assertSessionId(sessionId: string): void {
  if (!sessionIdPattern.test(sessionId)) {
    throw new Error("invalid session id: expected letters, digits, underscore or dash")
  }
}

function assertSessionToken(sessionToken: string): void {
  if (!sessionTokenPattern.test(sessionToken)) {
    throw new Error("invalid session token: expected base64url characters without newlines")
  }
}

async function defaultUserDataPath(): Promise<string> {
  const electron = await import("electron")
  const userDataPath = electron.app?.getPath("userData")
  if (typeof userDataPath !== "string" || userDataPath.length === 0) {
    throw new Error("userData path is not available outside Electron")
  }
  return userDataPath
}
