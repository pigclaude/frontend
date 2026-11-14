// 负责查询模型目录：先经本机 daemon 读当次选中账号的组织模型，再在一次性环境里用占位 token
// 让 Claude Code 列出模型，查询结束立即删除环境。真实凭据只留在 daemon 里。
// 读不到组织模型时只列内置模型，Claude Code 列不出时改用内置兜底目录；两种情况都提示用户。

import type { OrganizationModel, OrganizationModelReader } from "./claude-bootstrap"
import { CLAUDE_FALLBACK_MODELS } from "./claude-model-catalog"
import { classifyDaemonError } from "./session-error-mapping"
import { SessionHostError, type ClaudeModel, type SessionModelCatalog } from "./session-types"
import type {
  SessionAdapterFactory,
  SessionEnvironmentFactory,
  SessionErrorCode,
  SessionProfile,
  SessionRuntime,
} from "./session-types"
import { assertWorkspace, createEnvironmentOrThrow, errorMessage } from "./session-host-support"
import { normalizeSessionLocale, normalizeSessionTimezone } from "./session-locale"
import { boundSessionEnvironment } from "./bound-session-environment"

const organizationUnavailableNotice = "暂时读不到 Claude 账号所在组织的模型，只显示内置模型。"
const catalogUnavailableNotice = "暂时读不到 Claude Code 的模型列表，先显示内置模型。"

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
  readBinaryPath: () => string
  userDataPath: string
  newId: () => string
  hostError: (code: SessionErrorCode, message: string) => SessionHostError
  /** 给用户的一次性提示；界面用全局通知展示。 */
  notify: (message: string) => void
}

/** 查询模型目录。保证会员有效时返回的列表不为空；降级时只提示一次，Claude Code 失败的原因放进 cliError。 */
export async function queryModels(options: SessionModelQueryOptions): Promise<SessionModelCatalog> {
  await options.assertMembership()
  const organizationModels = await readOrganization(options)
  try {
    const models = await listCliModels(options, organizationModels)
    if (organizationModels === null) options.notify(organizationUnavailableNotice)
    return { models, cliError: null }
  } catch (error) {
    options.notify(catalogUnavailableNotice)
    return { models: [...CLAUDE_FALLBACK_MODELS], cliError: cliErrorText(error, options.hostError) }
  }
}

async function readOrganization(
  options: SessionModelQueryOptions,
): Promise<OrganizationModel[] | null> {
  const baseUrl = options.runtime.daemonBaseUrl
  if (baseUrl === null) return null
  return options
    .readOrganizationModels({ baseUrl, sessionToken: options.runtime.sessionToken })
    .catch(() => null)
}

async function listCliModels(
  options: SessionModelQueryOptions,
  organizationModels: OrganizationModel[] | null,
): Promise<ClaudeModel[]> {
  const daemonBaseUrl = options.runtime.daemonBaseUrl
  if (daemonBaseUrl === null) {
    throw new SessionHostError("DAEMON_UNAVAILABLE", "本机 daemon 尚未就绪")
  }
  const workspace = options.defaultWorkspace()
  await assertWorkspace(workspace)
  const profile = await options.resolveProfile(null)
  const environment = await createEnvironmentOrThrow(
    (input) => boundSessionEnvironment(options.runtime, profile, options.createEnvironment, input),
    {
      sessionId: options.newId(),
      workspace,
      daemonBaseUrl,
      sessionToken: options.runtime.sessionToken,
      timezone: normalizeSessionTimezone(profile?.timezone),
      locale: normalizeSessionLocale(profile?.locale),
      binaryPath: options.readBinaryPath(),
      userDataPath: options.userDataPath,
      modelCatalog: { organizationModels },
    },
    options.runtime.sessionToken,
  )
  try {
    return await options
      .createAdapter(() => undefined)
      .models({
        workspace: environment.workspace,
        env: environment.env,
        binaryPath: environment.binaryPath,
      })
  } finally {
    await environment.cleanup().catch(() => undefined)
  }
}

function cliErrorText(error: unknown, hostError: SessionModelQueryOptions["hostError"]): string {
  if (error instanceof SessionHostError) return error.message
  const message = errorMessage(error)
  return hostError(classifyDaemonError(message) ?? "SDK_ERROR", message).message
}
