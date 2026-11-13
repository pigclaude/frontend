// 负责查询 SDK 支持的模型；每次都用默认工作区创建一次性环境，查询结束立即删除。
// 模型探测使用真实账号凭据，才能拿到账号所属 org 的完整目录；会话本身仍走 daemon 和占位 token。

import { classifyDaemonError } from "./session-error-mapping"
import { SessionHostError, type ClaudeModel } from "./session-types"
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
import type { ModelAuth } from "./session-environment"

/** 模型查询依赖；所有会话状态通过参数传入，避免 SessionHost 主文件继续膨胀。 */
export type SessionModelQueryOptions = {
  assertMembership: () => Promise<void>
  runtime: SessionRuntime
  createEnvironment: SessionEnvironmentFactory
  createAdapter: SessionAdapterFactory
  resolveProfile: (accountId: string | null) => Promise<SessionProfile | null>
  /** 取一个可用账号的凭据；失败时退回占位 token 和静态目录。 */
  resolveModelAuth: (accountId: string | null) => Promise<ModelAuth | null>
  defaultWorkspace: () => string
  readBinaryPath: () => string
  userDataPath: string
  newId: () => string
  hostError: (code: SessionErrorCode, message: string) => SessionHostError
}

/** 查询支持模型；用默认工作区创建临时环境，查询结束立即删除。 */
export async function queryModels(options: SessionModelQueryOptions): Promise<ClaudeModel[]> {
  try {
    await options.assertMembership()
    const daemonBaseUrl = options.runtime.daemonBaseUrl
    if (daemonBaseUrl === null) {
      throw new SessionHostError("DAEMON_UNAVAILABLE", "本机 daemon 尚未就绪")
    }
    const workspace = options.defaultWorkspace()
    await assertWorkspace(workspace)
    const profile = await options.resolveProfile(null)
    const modelAuth = await options.resolveModelAuth(null).catch(() => null)
    const environment = await createEnvironmentOrThrow(
      (input) =>
        boundSessionEnvironment(options.runtime, profile, options.createEnvironment, input),
      {
        sessionId: options.newId(),
        workspace,
        daemonBaseUrl,
        sessionToken: options.runtime.sessionToken,
        timezone: normalizeSessionTimezone(profile?.timezone),
        locale: normalizeSessionLocale(profile?.locale),
        binaryPath: options.readBinaryPath(),
        userDataPath: options.userDataPath,
        ...(modelAuth === null ? {} : { modelAuth }),
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
  } catch (error) {
    if (error instanceof SessionHostError) throw error
    const message = errorMessage(error)
    throw options.hostError(classifyDaemonError(message) ?? "SDK_ERROR", message)
  }
}
