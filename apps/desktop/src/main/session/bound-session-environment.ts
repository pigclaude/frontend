// 把配置使用权、会话的 daemon 令牌与 CLI 临时环境一起管理：停止后立即吊销令牌，
// 清理结束前保留配置使用权。

import type { SessionEnvironmentInput } from "./session-environment"
import type {
  SessionEnvironmentFactory,
  SessionEnvironmentPort,
  SessionProfile,
  SessionRuntimeLease,
} from "./session-types"
import { SessionHostError } from "./session-types"

/** 先绑定共享配置，再创建真实环境；清理时先吊销会话令牌，删除临时环境后释放绑定，删除失败也释放。 */
export async function boundSessionEnvironment(
  session: SessionRuntimeLease,
  profile: SessionProfile | null,
  create: SessionEnvironmentFactory,
  input: SessionEnvironmentInput,
): Promise<SessionEnvironmentPort> {
  if (!profile) throw new SessionHostError("NO_AVAILABLE_ACCOUNT", "账号没有可用的浏览器配置")
  const { proxyBridgeUrl, release } = await session.bindEnvironment(
    { ...profile, timezone: input.timezone, locale: input.locale },
    { useAccountProxy: input.provider === undefined },
  )
  try {
    const environment = await create({
      ...input,
      ...(proxyBridgeUrl === undefined ? {} : { proxyBridgeUrl }),
    })
    return {
      env: environment.env,
      ...(environment.projectConfiguration === undefined
        ? {}
        : { projectConfiguration: environment.projectConfiguration }),
      configDir: environment.configDir,
      sessionDir: environment.sessionDir,
      workspace: environment.workspace,
      binaryPath: environment.binaryPath,
      timezone: environment.timezone,
      cleanup: async () => {
        session.close()
        try {
          await environment.cleanup()
        } finally {
          release()
        }
      },
    }
  } catch (error: unknown) {
    release()
    throw error
  }
}
