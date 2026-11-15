// 为每次会话启动登记能力插件的进程内 MCP 服务，并在宿主里落实每次调用的审批。

import {
  createSdkMcpServer,
  type CanUseTool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js"
import type {
  CapabilityPluginPermissionSource,
  CapabilityPluginToolApproval,
} from "../../capability-plugin-contract"
import { McpApprovalAttribution } from "../session/mcp-approval-attribution"
import type { PermissionBroker } from "../session/permission-broker"
import type { SessionMembership } from "../session/session-types"
import type { CapabilityPluginSnapshot } from "./capability-plugin-snapshot"
import type { CapabilityPluginToolDependencies } from "./capability-plugin-tool-dependencies"
import {
  capabilityPluginInvocation,
  capabilityPluginToolError,
  executeCapabilityPluginTool,
} from "./capability-plugin-tool-execution"
import { capabilityPluginServerName, capabilityPluginToolName } from "./capability-plugin-tool-name"

/** 调用只使用本会话的审批队列和标识，结束会话时取消待答请求和在途 Worker。 */
export type CapabilityPluginToolContext = {
  sessionId: string
  workspace: string
  membership: SessionMembership
  broker: Pick<PermissionBroker, "request">
  signal: AbortSignal
  denyUnattended: (() => void) | undefined
}

type Registration = {
  source: CapabilityPluginPermissionSource
  approval: CapabilityPluginToolApproval
}

/** 识别本会话登记的 SDK 工具，以便路由 SDK 的权限检查和来源信息。 */
export type CapabilityPluginToolApprovals = {
  lookup(toolName: string, server: Parameters<CanUseTool>[2]["mcpServer"]): Registration | undefined
  available(): boolean
  rememberCaller: McpApprovalAttribution["remember"]
}

const unavailable = "This capability plugin is unavailable for this session."

/** 为本次启动固定工具及询问档；清单中的 JSON Schema 原样通过 MCP 公布。 */
export async function createSessionPluginTools(
  deps: CapabilityPluginToolDependencies,
  context: CapabilityPluginToolContext,
): Promise<
  | {
      servers: Record<string, McpSdkServerConfigWithInstance>
      approvals: CapabilityPluginToolApprovals
    }
  | undefined
> {
  const available = () => !context.signal.aborted && context.membership.view().state === "active"
  if (!available()) return undefined
  const snapshots = await deps.manager.snapshotEnabled().catch(() => [])
  if (!available()) return undefined
  const servers: Record<string, McpSdkServerConfigWithInstance> = {}
  const registered = new Map<string, Registration & { serverName: string }>()
  const attribution = new McpApprovalAttribution(context.signal)
  for (const plugin of snapshots) {
    const { id, name, tools } = plugin.manifest
    const approval = plugin.toolApproval
    const serverName = capabilityPluginServerName(id)
    const definitions = new Map<string, Tool>()
    for (const { name: toolName, description, inputSchema } of tools) {
      // 自动审批档按工具注解判断是否询问；执行前仍由宿主逐次核准。
      const definition = ToolSchema.safeParse({
        name: toolName,
        description,
        inputSchema,
        ...(approval === "always_ask" ? { annotations: { destructiveHint: true } } : {}),
      })
      if (!definition.success) continue
      definitions.set(toolName, definition.data)
      registered.set(capabilityPluginToolName(id, toolName), {
        approval,
        serverName,
        source: { id, name, toolName },
      })
    }
    if (definitions.size === 0) continue
    const { instance, ...config } = createSdkMcpServer({ name: serverName })
    instance.server.registerCapabilities({ tools: {} })
    instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...definitions.values()],
    }))
    instance.server.setRequestHandler(CallToolRequestSchema, ({ params }, { signal, _meta }) => {
      if (!definitions.has(params.name))
        return capabilityPluginToolError("The requested capability plugin tool is unavailable.")
      const agentId = attribution.take(capabilityPluginToolName(id, params.name), _meta)
      return callTool(
        deps,
        context,
        plugin,
        { name: params.name, args: params.arguments ?? {}, agentId },
        signal,
      )
    })
    servers[serverName] = {
      ...config,
      instance,
      ...(approval === "always_ask"
        ? {
            tools: Array.from(definitions.keys(), (name) => ({
              name,
              permission_policy: "always_ask",
            })),
          }
        : {}),
    }
  }
  if (registered.size === 0) return undefined
  return {
    servers,
    approvals: {
      available,
      rememberCaller: (toolName, request) => attribution.remember(toolName, request),
      lookup(toolName, server) {
        if (server?.source !== "sdk") return undefined
        const registration = registered.get(toolName)
        return registration?.serverName === server.name ? registration : undefined
      },
    },
  }
}

async function callTool(
  deps: CapabilityPluginToolDependencies,
  context: CapabilityPluginToolContext,
  plugin: CapabilityPluginSnapshot,
  {
    name: toolName,
    args,
    agentId,
  }: {
    name: string
    args: Record<string, unknown>
    agentId: string | undefined
  },
  invocation: AbortSignal,
): Promise<CallToolResult> {
  const membership = new AbortController()
  const unsubscribe = context.membership.subscribe((view) => {
    if (view.state !== "active") membership.abort()
  })
  const signal = AbortSignal.any([context.signal, invocation, membership.signal])
  const { id, name } = plugin.manifest
  const available = () => !signal.aborted && context.membership.view().state === "active"
  try {
    if (!available() || !(await deps.manager.canInvoke(id, plugin.revision)) || !available())
      return capabilityPluginToolError(unavailable)
    const input = capabilityPluginInvocation(args, {
      sessionId: context.sessionId,
      workspace: context.workspace,
    })
    if (plugin.toolApproval === "always_ask") {
      if (context.denyUnattended !== undefined) {
        context.denyUnattended()
        return capabilityPluginToolError("This capability plugin requires interactive approval.")
      }
      const answer = await context.broker.request(capabilityPluginToolName(id, toolName), args, {
        signal,
        defaultToNo: true,
        suppressAlwaysAllowRule: true,
        plugin: { id, name, toolName },
        ...(agentId === undefined ? {} : { agentID: agentId }),
      })
      if (answer.behavior !== "allow")
        return capabilityPluginToolError("The user did not approve this capability plugin call.")
    }
    if (!available()) return capabilityPluginToolError(unavailable)
    return await executeCapabilityPluginTool(deps, plugin, toolName, input, signal)
  } catch {
    return capabilityPluginToolError("The capability plugin could not complete this operation.")
  } finally {
    unsubscribe()
  }
}
