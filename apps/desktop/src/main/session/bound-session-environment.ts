// 把配置使用权与 CLI 临时环境一起管理，环境清理确认前不会放开配置编辑。

import type { SessionEnvironmentInput } from "./session-environment"
import type {
  SessionEnvironmentFactory,
  SessionEnvironmentPort,
  SessionProfile,
  SessionRuntime,
} from "./session-types"
import { SessionHostError } from "./session-types"

/** 先绑定共享配置，再创建真实环境；创建失败或正常清理均释放对应绑定。 */
export async function boundSessionEnvironment(
  runtime: SessionRuntime,
  profile: SessionProfile | null,
  create: SessionEnvironmentFactory,
  input: SessionEnvironmentInput,
): Promise<SessionEnvironmentPort> {
  if (!profile) throw new SessionHostError("NO_AVAILABLE_ACCOUNT", "账号没有可用的浏览器配置")
  const release =
    (await runtime.bindEnvironment?.({
      ...profile,
      timezone: input.timezone,
      locale: input.locale,
    })) ?? (() => undefined)
  try {
    const environment = await create(input)
    return {
      env: environment.env,
      configDir: environment.configDir,
      sessionDir: environment.sessionDir,
      workspace: environment.workspace,
      binaryPath: environment.binaryPath,
      timezone: environment.timezone,
      cleanup: async () => {
        await environment.cleanup()
        release()
      },
    }
  } catch (error: unknown) {
    release()
    throw error
  }
}
