// 负责查询 SDK 支持的模型；有活动会话时复用它的隔离环境，否则创建一次性环境并清理。
// 不启动真实 CLI、不访问网络，便于在 SessionHost 之外单独维护模型查询的生命周期。

import { classifyDaemonError } from "./session-error-mapping"
import { SessionHostError, type ClaudeModel } from "./session-types"
import type {
  SessionAdapterFactory,
  SessionEnvironmentFactory,
  SessionErrorCode,
  SessionProfile,
  SessionRuntime,
} from "./session-types"
import type { ActiveSession } from "./session-host-support"
import { assertWorkspace, createEnvironmentOrThrow, errorMessage } from "./session-host-support"
import { normalizeSessionLocale, normalizeSessionTimezone } from "./session-locale"

/** 模型查询依赖；所有会话状态通过参数传入，避免 SessionHost 主文件继续膨胀。 */
export type SessionModelQueryOptions = {
  active: ActiveSession | null
  assertMembership: () => Promise<void>
  runtime: SessionRuntime
  createEnvironment: SessionEnvironmentFactory
  createAdapter: SessionAdapterFactory
  resolveProfile: (accountId: string | null) => Promise<SessionProfile | null>
  defaultWorkspace: () => string
  readBinaryPath: () => string
  userDataPath: string
  newId: () => string
  hostError: (code: SessionErrorCode, message: string) => SessionHostError
}

/** 查询支持模型；没有活动会话时用默认工作区创建临时环境，查询结束立即删除。 */
export async function queryModels(options: SessionModelQueryOptions): Promise<ClaudeModel[]> {
  try {
    const active = options.active
    if (active !== null) {
      return await active.adapter.models({
        workspace: active.environment.workspace,
        env: active.environment.env,
        binaryPath: active.environment.binaryPath,
      })
    }
    await options.assertMembership()
    const daemonBaseUrl = options.runtime.daemonBaseUrl
    if (daemonBaseUrl === null) {
      throw new SessionHostError("DAEMON_UNAVAILABLE", "本机 daemon 尚未就绪")
    }
    const workspace = options.defaultWorkspace()
    await assertWorkspace(workspace)
    const profile = await options.resolveProfile(null).catch(() => null)
    const environment = await createEnvironmentOrThrow(
      options.createEnvironment,
      {
        sessionId: options.newId(),
        workspace,
        daemonBaseUrl,
        sessionToken: options.runtime.sessionToken,
        timezone: normalizeSessionTimezone(profile?.timezone),
        locale: normalizeSessionLocale(profile?.locale),
        binaryPath: options.readBinaryPath(),
        userDataPath: options.userDataPath,
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
