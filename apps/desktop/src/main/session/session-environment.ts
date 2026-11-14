// 负责为一个会话或一次模型目录查询创建隔离的配置目录、环境变量和 Intl 预加载文件；不读用户设置，不保存真实凭据。
// NODE_OPTIONS 的 --require 只在 Node 运行时生效；SDK 0.3.310 启动原生/Bun CLI 时会删除该变量，
// 因此原生 CLI 的实际时区来源是 TZ，intl-preload.cjs 只是为 Node 运行时保留的兜底。

import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { buildSessionEnv } from "@pigclaude/session-env"
import { cliModelCache, type OrganizationModel } from "./claude-bootstrap"
import { normalizeSessionLocale, normalizeSessionTimezone } from "./session-locale"

/** 会话环境里的非秘密占位 token；真实 access token 只留在 daemon 内。 */
export const placeholderOAuthToken = "pigclaude-local"

/** 本机会话使用的 NO_PROXY 值，保证回环请求不经过账号代理。 */
export const localNoProxy = "127.0.0.1,localhost"

/** 开发期供应商会话需要从宿主继承的运行变量；不含任何凭据。 */
const hostEnvNames = ["PATH", "HOME", "SHELL", "TMPDIR", "USER", "LOGNAME"] as const

const sessionDirectoryMode = 0o700
const sessionIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const sessionTokenPattern = /^[A-Za-z0-9_-]+$/

/** 模型目录查询的输入；organizationModels 为 null 表示没读到账号组织的模型。 */
export type ModelCatalogInput = { organizationModels: readonly OrganizationModel[] | null }

/** 自定义供应商端点；目前只有开发期覆盖会传入，会话直接连供应商而不经过 daemon。 */
export type SessionProvider = {
  baseUrl: string
  authToken: string
}

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
  /** 只在模型目录查询时提供：关闭非必要流量，并把组织模型写进 CLI 的模型缓存。 */
  modelCatalog?: ModelCatalogInput
  /** 开发期自定义供应商；提供时替换 daemon 地址和会话 token，并忽略 modelCatalog。 */
  provider?: SessionProvider
}

/** 一次会话的环境和目录。timezone 供上层记录和 Task 6 验收；cleanup 删除整个 sessions/<sessionId>，可重复调用。 */
export class SessionEnvironment {
  readonly env: Record<string, string>
  readonly configDir: string
  readonly sessionDir: string
  readonly workspace: string
  readonly binaryPath: string
  /** 账号/代理出口时区；原生 CLI 靠 env.TZ 生效，预加载只在 Node 运行时生效。 */
  readonly timezone: string
  #cleaned = false

  private constructor(input: {
    env: Record<string, string>
    configDir: string
    sessionDir: string
    workspace: string
    binaryPath: string
    timezone: string
  }) {
    this.env = input.env
    this.configDir = input.configDir
    this.sessionDir = input.sessionDir
    this.workspace = input.workspace
    this.binaryPath = input.binaryPath
    this.timezone = input.timezone
  }

  /** 创建 0700 的会话目录、配置目录和 Intl 预加载，并返回本次会话的环境和时间；失败时删除已创建的目录。 */
  static async create(input: SessionEnvironmentInput): Promise<SessionEnvironment> {
    assertSessionId(input.sessionId)
    assertSessionToken(input.sessionToken)
    if (!isAbsolute(input.workspace)) throw new Error("workspace must be an absolute path")
    const userDataPath = input.userDataPath ?? (await defaultUserDataPath())
    const sessionsDir = join(userDataPath, "sessions")
    const sessionDir = join(sessionsDir, input.sessionId)
    const configDir = join(sessionDir, "claude")
    const preloadPath = join(sessionDir, "intl-preload.cjs")
    // 这里是环境的最后一道关口：空语言和 system 时区不能进入 TZ、LANG 或 Intl 预加载。
    const normalized: SessionEnvironmentInput = {
      ...input,
      timezone: normalizeSessionTimezone(input.timezone),
      locale: normalizeSessionLocale(input.locale),
    }
    const env = buildEnvironment(normalized, configDir, preloadPath)
    const preloadSource = buildSessionEnv({
      daemonBaseUrl: normalized.daemonBaseUrl,
      timezone: normalized.timezone,
      locale: normalized.locale,
      userSettingsEnv: {},
    }).preloadSource

    let created = false
    try {
      await mkdir(sessionsDir, { recursive: true, mode: sessionDirectoryMode })
      await mkdir(sessionDir, { mode: sessionDirectoryMode })
      created = true
      await mkdir(configDir, { mode: sessionDirectoryMode })
      await writeFile(preloadPath, preloadSource, { mode: sessionDirectoryMode })
      const organizationModels = normalized.provider
        ? null
        : (normalized.modelCatalog?.organizationModels ?? null)
      // 空列表也不写：answeredAt 会让 CLI 换一条判断模型可用性的路径。
      if (organizationModels !== null && organizationModels.length > 0) {
        const configPath = join(configDir, ".claude.json")
        await writeFile(configPath, JSON.stringify(cliModelCache(organizationModels, Date.now())), {
          mode: 0o600,
        })
        await chmod(configPath, 0o600)
      }
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
      timezone: normalized.timezone,
    })
  }

  /** 删除整个会话目录。保证重复调用安全，且不会删除 sessions 父目录。 */
  async cleanup(): Promise<void> {
    if (this.#cleaned) return
    await rm(this.sessionDir, { recursive: true, force: true })
    this.#cleaned = true
  }
}

/**
 * 清理本次启动前已存在的 sessions/<id> 目录，保留 keep 中列出的当前会话。
 * 保证 sessions 父目录不存在时不报错，也不会删除父目录本身。
 */
export async function cleanupStaleSessionDirs(
  userDataPath: string,
  keep: readonly string[] = [],
): Promise<void> {
  const sessionsDir = join(userDataPath, "sessions")
  let entries: string[]
  try {
    entries = await readdir(sessionsDir)
  } catch (error: unknown) {
    if (isEnoent(error)) return
    throw error
  }
  const kept = new Set(keep)
  await Promise.all(
    entries
      .filter((name) => !kept.has(name))
      .map((name) => rm(join(sessionsDir, name), { recursive: true, force: true })),
  )
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
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
  env.CLAUDE_CONFIG_DIR = configDir
  env.NODE_OPTIONS = `--require ${JSON.stringify(preloadPath)}`
  env.NO_PROXY = localNoProxy
  env.no_proxy = localNoProxy
  if (input.provider) {
    // 开发期覆盖：会话直连自定义供应商，不再经过 daemon，也不带 daemon 的会话头。
    // 没有 daemon 帮忙合并宿主环境，这里补上 CLI 运行工具必需的宿主变量。
    for (const name of hostEnvNames) {
      const value = process.env[name]
      if (value !== undefined && value !== "") env[name] = value
    }
    env.ANTHROPIC_BASE_URL = input.provider.baseUrl
    env.ANTHROPIC_AUTH_TOKEN = input.provider.authToken
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
    env.ENABLE_TOOL_SEARCH = "false"
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    delete env.ANTHROPIC_CUSTOM_HEADERS
    return env
  }
  env.CLAUDE_CODE_OAUTH_TOKEN = placeholderOAuthToken
  env.ANTHROPIC_CUSTOM_HEADERS = `x-pigclaude-session: ${input.sessionToken}`
  // 模型目录查询期间 Claude Code 不能自己发功能开关、bootstrap 和遥测请求。
  if (input.modelCatalog) env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
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
