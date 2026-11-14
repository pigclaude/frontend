// 负责查询模型目录：为这次查询注册一个临时 daemon 令牌，先经本机 daemon 读当次选中账号的组织模型，
// 再在一次性环境里用占位 token 让 Claude Code 列出模型，查询结束立即删除环境、吊销令牌。真实凭据只留在 daemon 里。
// 读不到组织模型时只列内置模型，Claude Code 列不出时改用内置兜底目录；两种情况都提示用户。

import type { OrganizationModel, OrganizationModelReader } from "./claude-bootstrap"
import { CLAUDE_FALLBACK_MODELS } from "./claude-model-catalog"
import { classifyDaemonError } from "./session-error-mapping"
import { SessionHostError, type ClaudeModel, type SessionModelCatalog } from "./session-types"
import type {
  SessionAdapterFactory,
  SessionEnvironmentFactory,
  SessionProfile,
  SessionRuntime,
  SessionRuntimeLease,
} from "./session-types"
import {
  assertWorkspace,
  createEnvironmentOrThrow,
  errorMessage,
  hostError,
  readBinaryPath,
} from "./session-host-support"
import { normalizeSessionLocale, normalizeSessionTimezone } from "./session-locale"
import { boundSessionEnvironment } from "./bound-session-environment"

const organizationUnavailableNotice = "暂时读不到 Claude 账号所在组织的模型，只显示内置模型。"
const catalogUnavailableNotice = "暂时读不到 Claude Code 的模型列表，先显示内置模型。"
// 读组织模型和 Claude Code 列模型共用这一个上限，界面最多等 20 秒，要在那之前给出回退目录。
const catalogQueryBudgetMs = 15_000

/** 模型查询依赖；所有会话状态通过参数传入，避免 SessionHost 主文件继续膨胀。 */
export type SessionModelQueryOptions = {
  assertMembership: () => Promise<void>
  runtime: SessionRuntime
  createEnvironment: SessionEnvironmentFactory
  createAdapter: SessionAdapterFactory
  resolveProfile: (accountId: string | null) => Promise<SessionProfile | null>
  /** 经 daemon 读当次选中账号的组织模型。 */
  readOrganizationModels: OrganizationModelReader
  defaultWorkspace: () => string
  resolveBinaryPath: () => string
  userDataPath: string
  newId: () => string
  now: () => number
  /** 给用户的一次性提示；界面用全局通知展示。 */
  notify: (message: string) => void
}

/** 查询模型目录。保证会员有效时返回的列表不为空；降级时只提示一次，Claude Code 失败的原因放进 cliError。 */
export async function queryModels(options: SessionModelQueryOptions): Promise<SessionModelCatalog> {
  await options.assertMembership()
  const deadline = options.now() + catalogQueryBudgetMs
  const session = options.runtime.openSession({
    sessionId: options.newId(),
    preferredAccountId: null,
  })
  try {
    const organizationModels = await readOrganization(options, session)
    try {
      const models = await listCliModels(options, session, organizationModels, deadline)
      if (organizationModels === null) options.notify(organizationUnavailableNotice)
      return { models, cliError: null }
    } catch (error) {
      options.notify(catalogUnavailableNotice)
      return { models: [...CLAUDE_FALLBACK_MODELS], cliError: cliErrorText(error, session.token) }
    }
  } finally {
    session.close()
  }
}

async function readOrganization(
  options: SessionModelQueryOptions,
  session: SessionRuntimeLease,
): Promise<OrganizationModel[] | null> {
  const baseUrl = options.runtime.daemonBaseUrl
  if (baseUrl === null) return null
  return options.readOrganizationModels({ baseUrl, sessionToken: session.token }).catch(() => null)
}

async function listCliModels(
  options: SessionModelQueryOptions,
  session: SessionRuntimeLease,
  organizationModels: OrganizationModel[] | null,
  deadline: number,
): Promise<ClaudeModel[]> {
  const daemonBaseUrl = options.runtime.daemonBaseUrl
  if (daemonBaseUrl === null) {
    throw new SessionHostError("DAEMON_UNAVAILABLE", "本机 daemon 尚未就绪")
  }
  const workspace = options.defaultWorkspace()
  await assertWorkspace(workspace)
  const profile = await options.resolveProfile(null)
  const environment = await createEnvironmentOrThrow(
    (input) => boundSessionEnvironment(session, profile, options.createEnvironment, input),
    {
      sessionId: session.sessionId,
      workspace,
      daemonBaseUrl,
      sessionToken: session.token,
      timezone: normalizeSessionTimezone(profile?.timezone),
      locale: normalizeSessionLocale(profile?.locale),
      binaryPath: readBinaryPath(options.resolveBinaryPath, session.token),
      userDataPath: options.userDataPath,
      modelCatalog: { organizationModels },
    },
    session.token,
  )
  try {
    return await options
      .createAdapter(() => undefined)
      .models({
        workspace: environment.workspace,
        env: environment.env,
        binaryPath: environment.binaryPath,
        timeoutMs: Math.max(1, deadline - options.now()),
      })
  } finally {
    await environment.cleanup().catch(() => undefined)
  }
}

function cliErrorText(error: unknown, token: string): string {
  if (error instanceof SessionHostError) return error.message
  const message = errorMessage(error)
  return hostError(classifyDaemonError(message) ?? "SDK_ERROR", message, token).message
}
