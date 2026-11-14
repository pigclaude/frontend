// 负责一次性模型查询：启动一个只读模型列表的 SDK query，读完或超时都立即关闭，不广播会话事件。

import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { mergeClaudeModels } from "./claude-model-catalog"
import { closeQuietly, type AdapterQuery, type QueryFn } from "./claude-query"
import { isolatedQueryOptions } from "./claude-query-options"
import { PromptStream } from "./prompt-stream"
import type { ClaudeModel } from "./session-events"

/** 查询模型列表的参数；env 由调用方提供，避免把宿主进程的凭据带进子进程。 */
export type ClaudeModelsOptions = {
  workspace?: string
  env?: Record<string, string>
  binaryPath?: string
  /** 这一次查询的有界等待时间；省略时用适配器的 modelsTimeoutMs。 */
  timeoutMs?: number
}

/** 一次查询的已解析参数：二进制路径和等待时间都已确定。 */
type ResolvedModelQuery = Omit<ClaudeModelsOptions, "binaryPath" | "timeoutMs"> & {
  queryFn: QueryFn
  binaryPath: string
  timeoutMs: number
}

/**
 * 读取 SDK 支持的模型并合并内置目录。保证整次查询有界：超时或取消时关闭 query、结束输入流并抛出可读错误；
 * 还在创建的 query 返回后立刻关闭，不留下进程。
 */
export async function queryClaudeModels(request: ResolvedModelQuery): Promise<ClaudeModel[]> {
  const prompt = new PromptStream()
  const abortController = new AbortController()
  const sdkOptions: Options = {
    ...isolatedQueryOptions(request.workspace ?? process.cwd(), request.binaryPath, request.env),
    permissionMode: "default",
    abortController,
  }
  let query: AdapterQuery | null = null
  let creation: Promise<AdapterQuery> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abortController.abort()
      reject(new Error(`MODEL_QUERY_TIMEOUT: 模型查询超时（${request.timeoutMs} 毫秒）`))
    }, request.timeoutMs)
  })
  try {
    creation = Promise.resolve(request.queryFn({ prompt, options: sdkOptions }))
    query = await Promise.race([creation, timeout])
    const models = await Promise.race([query.supportedModels(), timeout])
    return mergeClaudeModels(models)
  } finally {
    if (timer !== null) clearTimeout(timer)
    prompt.end()
    abortController.abort()
    closeModelQuery(query, creation)
  }
}

function closeModelQuery(query: AdapterQuery | null, creation: Promise<AdapterQuery> | null): void {
  if (query !== null) {
    closeQuietly(query)
    return
  }
  if (creation === null) return
  void creation.then(closeQuietly, () => undefined)
}
