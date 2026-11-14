// 负责随包 Claude Code 2.1.310 的 bootstrap 合同：经本机 daemon 读取当次选中账号的组织模型，
// 再整理成 CLI 配置目录 .claude.json 里的模型缓存。请求参数、请求头、响应格式和两个缓存键
// 都是这个 CLI 版本的内部约定；升级随包 CLI 时要重新核实。

import { request } from "undici"
import { z } from "zod"

/** 随包 Claude Code 的版本；bootstrap 请求的 User-Agent 跟它一致。 */
export const claudeCodeVersion = "2.1.310"

/** CLI 模型缓存里的一项组织模型，形状和 CLI 写进配置目录的一致。 */
export type OrganizationModel = { value: string; label: string; description: string }

/** 本机 daemon 的地址和会话令牌。 */
export type DaemonEndpoint = { baseUrl: string; sessionToken: string }

/** 经 daemon 读组织模型的函数；读不到时返回 null，不抛错。 */
export type OrganizationModelReader = (
  daemon: DaemonEndpoint,
) => Promise<OrganizationModel[] | null>

// 路径必须和 daemon 的凭据白名单一致；model 取随包 CLI 在会话环境里的默认模型。
const bootstrapPath = "/api/claude_cli/bootstrap"
const bootstrapQuery = { entrypoint: "sdk-ts", model: "claude-sonnet-5-5" }
const defaultTimeoutMs = 5_000

const bootstrapResponse = z.object({
  additional_model_options: z
    .array(
      z.object({
        model: z.string(),
        name: z.string(),
        description: z.string(),
        disabled_reason: z.string().nullish(),
      }),
    )
    .nullish(),
})

/**
 * 经 daemon 读取当次选中账号的组织模型，去掉账号不能用的项。
 * 保证 daemon 不可达、上游返回非 2xx、超时或响应格式不对时返回 null，不抛错。
 */
export async function readOrganizationModels(
  daemon: DaemonEndpoint,
  timeoutMs = defaultTimeoutMs,
): Promise<OrganizationModel[] | null> {
  const url = new URL(bootstrapPath, daemon.baseUrl)
  for (const [name, value] of Object.entries(bootstrapQuery)) url.searchParams.set(name, value)
  try {
    const response = await request(url, {
      method: "GET",
      headers: {
        "x-pigclaude-session": daemon.sessionToken,
        "user-agent": `claude-code/${claudeCodeVersion}`,
        "anthropic-beta": "oauth-2025-04-20",
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await response.body.dump()
      return null
    }
    const parsed = bootstrapResponse.safeParse(await response.body.json())
    if (!parsed.success) return null
    return (parsed.data.additional_model_options ?? [])
      .filter((option) => option.disabled_reason == null)
      .map((option) => ({
        value: option.model,
        label: option.name,
        description: option.description,
      }))
  } catch {
    return null
  }
}

/** 保证返回的对象就是 CLI 自己读完 bootstrap 后写进 .claude.json 的两项；answeredAt 是毫秒时间戳。 */
export function cliModelCache(
  models: readonly OrganizationModel[],
  answeredAt: number,
): {
  additionalModelOptionsCache: readonly OrganizationModel[]
  additionalModelOptionsAnsweredAt: number
} {
  return { additionalModelOptionsCache: models, additionalModelOptionsAnsweredAt: answeredAt }
}
