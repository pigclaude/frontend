// 负责开发期的自定义供应商覆盖：只在未打包的桌面进程里读环境变量，发布构建永远关闭。
// 覆盖替换会话的 API 地址、token 和模型，并因此不再要求本机有可用的 Claude 账号；
// 会员门禁保持生效，凭据也不进入渲染进程。

import type { SessionProvider } from "./session-environment"
import type { ClaudeModel } from "./session-types"

/** 开发期覆盖；model 为空时沿用界面选择的模型。 */
export type DevProviderOverride = SessionProvider & {
  model: string | null
}

export const devProviderBaseUrlVar = "PIGCLAUDE_DEV_PROVIDER_BASE_URL"
export const devProviderAuthTokenVar = "PIGCLAUDE_DEV_PROVIDER_AUTH_TOKEN"
export const devProviderModelVar = "PIGCLAUDE_DEV_PROVIDER_MODEL"

/** 读取开发期覆盖。保证打包构建永远返回 null；地址不是 http(s) 或缺少 token 时也返回 null。 */
export function readDevProviderOverride(
  env: Record<string, string | undefined>,
  packaged: boolean,
): DevProviderOverride | null {
  if (packaged) return null
  const baseUrl = env[devProviderBaseUrlVar]?.trim() ?? ""
  const authToken = env[devProviderAuthTokenVar]?.trim() ?? ""
  if (!isHttpUrl(baseUrl) || authToken === "") return null
  const model = env[devProviderModelVar]?.trim() ?? ""
  return { baseUrl, authToken, model: model === "" ? null : model }
}

/** 组装 SessionHost 的开发期覆盖参数；没有启用时返回空对象，启动日志只说模型不说地址和密钥。 */
export function devProviderHostOptions(
  packaged: boolean,
  env: Record<string, string | undefined>,
): { provider?: DevProviderOverride } {
  const provider = readDevProviderOverride(env, packaged)
  if (provider === null) return {}
  console.warn(`[pigclaude] 开发期自定义供应商已启用，模型：${provider.model ?? "界面选择"}`)
  return { provider }
}

/** 固定模型时给界面一个单项目录；没有固定模型时返回 null，沿用 CLI 返回的内置目录。 */
export function providerModelCatalog(provider: DevProviderOverride | null): ClaudeModel[] | null {
  if (provider === null || provider.model === null) return null
  return [
    {
      id: provider.model,
      displayName: provider.model,
      description: "开发期自定义供应商",
      isDefault: true,
    },
  ]
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}
