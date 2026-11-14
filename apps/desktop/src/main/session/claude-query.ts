// 负责 Claude Agent SDK query 的最小端口：适配器和一次性模型查询都通过它启动、关闭 SDK 进程。

import type { ModelInfo, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { SessionPermissionMode } from "./session-events"

/** SDK query 返回对象的最小端口；真实 Query 和测试假实现都满足。 */
export type AdapterQuery = AsyncIterable<SDKMessage> & {
  interrupt(): Promise<unknown>
  close(): void
  supportedModels(): Promise<ModelInfo[]>
  setPermissionMode(mode: SessionPermissionMode): Promise<void>
  setModel(model?: string): Promise<void>
}

/** 可注入的 SDK 查询函数，参数与 SDK query() 一致。 */
export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options: Options
}) => AdapterQuery | Promise<AdapterQuery>

/** 真实的 SDK query；首次调用时才加载 SDK。 */
export const defaultQueryFn: QueryFn = async ({ prompt, options }) => {
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  return sdk.query({ prompt, options })
}

/** 关闭 query；SDK 进程已经退出时忽略关闭失败。 */
export function closeQuietly(query: AdapterQuery): void {
  try {
    query.close()
  } catch {
    // SDK 进程可能已经退出，关闭失败不影响超时或结果。
  }
}
