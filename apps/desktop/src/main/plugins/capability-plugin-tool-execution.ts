// 限制插件 Worker 调用的时间和 JSON 体积，把失败转换成固定 MCP 文本。

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { CapabilityPluginSnapshot } from "./capability-plugin-manager"
import type { CapabilityPluginToolDependencies } from "./capability-plugin-tool-dependencies"
import {
  PluginSandboxError,
  pluginSandboxPayloadLimit,
  type PluginSandboxJson,
} from "./plugin-sandbox-contract"

const toolTimeoutMs = 15_000
const jsonArguments = z.record(z.string(), z.json())

/** 工具调用基本输入携带操作参数、不透明会话 id 和真实工作区路径。 */
export type CapabilityPluginInvocation = {
  arguments: Record<string, PluginSandboxJson>
  context: { sessionId: string; workspace: string }
}

/** 检查 MCP 参数是有界 JSON，保留原有结构并加上会话上下文。 */
export function capabilityPluginInvocation(
  args: Record<string, unknown>,
  context: CapabilityPluginInvocation["context"],
): CapabilityPluginInvocation {
  const value = { arguments: args, context }
  if (Buffer.byteLength(JSON.stringify(value)) > pluginSandboxPayloadLimit)
    throw new PluginSandboxError("PLUGIN_PAYLOAD_INVALID")
  const parsed = jsonArguments.safeParse(args)
  if (!parsed.success) throw new PluginSandboxError("PLUGIN_PAYLOAD_INVALID")
  return { arguments: parsed.data, context }
}

/** 执行一次已批准的调用，在出口解析后重新确认安装版本，超时会取消排队或运行的 Worker。 */
export async function executeCapabilityPluginTool(
  deps: CapabilityPluginToolDependencies,
  plugin: CapabilityPluginSnapshot,
  operation: string,
  input: CapabilityPluginInvocation,
  scope: AbortSignal,
): Promise<CallToolResult> {
  const deadline = AbortSignal.timeout(toolTimeoutMs)
  const signal = AbortSignal.any([scope, deadline])
  try {
    const result = await withinSignal(signal, async () => {
      const { manifest, revision, modules, approvedDomains } = plugin
      // 纯本地工具不需要等 Claude 选号，也不给沙箱分配网络端口。
      const network =
        approvedDomains.length === 0
          ? undefined
          : await deps.pluginNetwork(input.context.sessionId, {
              declaredDomains: manifest.networkDomains,
              approvedDomains,
            })
      signal.throwIfAborted()
      if (!(await deps.manager.canInvoke(manifest.id, revision)))
        throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
      const settings = await deps.settings?.(plugin, signal)
      signal.throwIfAborted()
      const capabilities = deps.capabilities?.(plugin, input.context.workspace)
      return deps.sandbox.invoke(
        {
          pluginId: manifest.id,
          revision,
          entry: manifest.entry,
          modules,
          egressId: network?.egressId ?? "no-network",
          ...(network === undefined ? {} : { network }),
        },
        { operation, input: settings === undefined ? input : { ...input, settings } },
        {
          signal,
          timeoutMs: toolTimeoutMs,
          ...(capabilities === undefined ? {} : { capabilities }),
        },
      )
    })
    signal.throwIfAborted()
    const text = typeof result === "string" ? result : JSON.stringify(result)
    return Buffer.byteLength(text) <= pluginSandboxPayloadLimit
      ? { content: [{ type: "text", text }] }
      : capabilityPluginToolError("The capability plugin result is too large.")
  } catch (error) {
    if (
      deadline.aborted ||
      (error instanceof PluginSandboxError && error.code === "PLUGIN_TIMEOUT")
    )
      return capabilityPluginToolError("The capability plugin timed out.")
    return capabilityPluginToolError("The capability plugin could not complete this operation.")
  }
}

/** 给 SDK 返回工具错误，保留固定说明，不回传进程失败详情。 */
export function capabilityPluginToolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

function withinSignal<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void work()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort))
  })
}
