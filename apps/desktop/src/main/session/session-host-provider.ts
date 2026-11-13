// 负责把开发期自定义供应商接到 SessionHost：替换会话环境、固定模型、给出单项目录，并在该模式下
// 不依赖 Claude 账号（供应商自己提供模型访问）；会员门禁不受影响。

import type { SessionEnvironmentInput } from "./session-environment"
import { providerModelCatalog, type DevProviderOverride } from "./dev-provider"
import { systemLocale, systemTimezone } from "./session-locale"
import type { ActiveSession } from "./session-host-support"
import { errorMessage, hostError } from "./session-host-support"
import {
  SessionHostError,
  type ClaudeModel,
  type SessionProfile,
  type SessionStartInput,
} from "./session-types"

/** 会话环境要用的供应商字段；没有覆盖时返回空对象，便于直接展开。 */
export function providerEnvironmentInput(
  provider: DevProviderOverride | null,
): Pick<SessionEnvironmentInput, "provider"> {
  if (provider === null) return {}
  return { provider: { baseUrl: provider.baseUrl, authToken: provider.authToken } }
}

/** 固定模型时覆盖界面选择；没有固定模型时原样返回启动输入。 */
export function pinnedStartInput(
  provider: DevProviderOverride | null,
  input: SessionStartInput,
): SessionStartInput {
  const model = pinnedModel(provider)
  return model === null ? input : { ...input, model }
}

/** 开发期覆盖固定的模型 id；没有覆盖或没有指定模型时为 null。 */
export function pinnedModel(provider: DevProviderOverride | null): string | null {
  return provider?.model ?? null
}

/** 固定模型时只接受同一个 id：相同则视为已完成，不同则拒绝，避免把界面选择发给供应商。 */
export function requirePinnedModel(pinned: string, model: string): void {
  if (model !== pinned) throw new SessionHostError("SDK_ERROR", `开发期供应商已固定模型：${pinned}`)
}

/** 固定模型时的单项目录；没有固定模型时返回 null，表示继续读 CLI 目录。 */
export function pinnedCatalog(provider: DevProviderOverride | null): ClaudeModel[] | null {
  return providerModelCatalog(provider)
}

/** 供应商模式下没有账号也要能启动：缺账号配置时用宿主语言和时区，浏览器配置不参与。 */
export function providerSessionProfile(profile: SessionProfile | null): SessionProfile {
  return profile ?? { timezone: systemTimezone(), locale: systemLocale() }
}

/** 切换后续回复使用的模型：固定模型时只接受同一个 id，其他失败脱敏后转成 SDK_ERROR。 */
export async function applyModelChange(
  active: ActiveSession,
  provider: DevProviderOverride | null,
  model: string,
  token: string,
): Promise<void> {
  if (model.trim() === "") throw new SessionHostError("SDK_ERROR", "模型不能为空")
  const pinned = pinnedModel(provider)
  if (pinned !== null) return requirePinnedModel(pinned, model)
  try {
    await active.adapter.setModel(model)
    active.model = model
  } catch (error) {
    throw hostError("SDK_ERROR", errorMessage(error), token)
  }
}
