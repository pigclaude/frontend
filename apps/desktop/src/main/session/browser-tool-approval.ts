// 负责会话内置浏览器工具的来源识别和逐次审批策略。

import type { McpSdkServerConfigWithInstance, PermissionMode } from "@anthropic-ai/claude-agent-sdk"
import type { BrowserPermissionContext } from "../../browser-permission-contract"
import { McpApprovalAttribution, type McpApprovalCaller } from "./mcp-approval-attribution"
import type { PermissionBroker } from "./permission-broker"

/** 主进程给 Claude SDK 注册的工作台服务名。 */
export const workbenchBrowserServer = "pigclaude_workbench"
const qualifiedServer = `mcp__${workbenchBrowserServer}`

const toolByContext = {
  open: "browser_open",
  snapshot: "browser_snapshot",
  navigate: "browser_navigate",
  click: "browser_click",
  screenshot: "browser_screenshot",
} as const satisfies Record<BrowserPermissionContext["kind"], string>

/** 当前工作台注册的浏览器工具名。 */
export type WorkbenchBrowserTool = (typeof toolByContext)[BrowserPermissionContext["kind"]]

/** 将经过主进程核验的审批内容绑定到唯一注册工具。 */
export function browserToolForContext(context: BrowserPermissionContext): WorkbenchBrowserTool {
  return toolByContext[context.kind]
}

/** 会话给工作台的逐次审批能力；拒绝返回给模型的英文说明。 */
export type BrowserApprovalPort = {
  denial(tool: WorkbenchBrowserTool): string | null
  rememberCaller(tool: WorkbenchBrowserTool, caller: McpApprovalCaller): void
  request(
    context: BrowserPermissionContext,
    invocationSignal?: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<boolean>
}

/** 会话创建工作台服务时注入权限代理；无人值守时根本不注册。 */
export type BrowserToolRegistration = {
  create(
    approval: BrowserApprovalPort,
    sessionId: string,
  ): Record<string, McpSdkServerConfigWithInstance>
  unattended?: boolean
}

/** 只信任 SDK 标记为进程内且服务键与完整工具名均匹配的内置浏览器工具。 */
export function builtinWorkbenchBrowserTool(
  name: string,
  server: { name: string; source: string } | undefined,
): WorkbenchBrowserTool | null {
  if (server?.source !== "sdk" || server.name !== workbenchBrowserServer) return null
  return Object.values(toolByContext).find((tool) => browserToolName(tool) === name) ?? null
}

/** 判断 SDK 规则是否会直接授予整个工作台服务或其中的工具。 */
export function workbenchBrowserRule(value: string): boolean {
  const tool = value.split("(")[0]?.trim()
  return tool === qualifiedServer || (tool?.startsWith(qualifiedServer + "__") ?? false)
}

/** 工具审批成功只允许这一调用，执行前再次确认会话和权限档仍有效。 */
export function createBrowserApproval(options: {
  broker: PermissionBroker
  mode(): PermissionMode
  canUse(): boolean
  sessionSignal: AbortSignal
  unattended: boolean
}): BrowserApprovalPort {
  const attribution = new McpApprovalAttribution(options.sessionSignal)
  const denial = (tool: WorkbenchBrowserTool): string | null => {
    if (!options.canUse() || options.sessionSignal.aborted)
      return "The browser is unavailable for this session."
    if (options.unattended || options.mode() === "dontAsk")
      return "Browser tools require an interactive session and explicit approval."
    if (options.mode() === "plan" && tool !== "browser_snapshot" && tool !== "browser_screenshot")
      return "Plan mode only allows browser snapshots and screenshots."
    return null
  }
  return {
    denial,
    rememberCaller(tool, caller) {
      attribution.remember(browserToolName(tool), caller)
    },
    async request(context, invocationSignal, metadata) {
      const { kind, ...details } = context
      const tool = toolByContext[kind]
      const input =
        kind === "screenshot" ? { width: context.width, height: context.height } : details
      const signal =
        invocationSignal === undefined
          ? options.sessionSignal
          : AbortSignal.any([options.sessionSignal, invocationSignal])
      if (signal.aborted || denial(tool) !== null) return false
      const name = browserToolName(tool)
      const agentID = attribution.take(name, metadata)
      const answer = await options.broker.request(
        name,
        input,
        {
          signal,
          defaultToNo: true,
          suppressAlwaysAllowRule: true,
          ...(agentID === undefined ? {} : { agentID }),
        },
        context,
      )
      return answer.behavior === "allow" && !signal.aborted && denial(tool) === null
    },
  }
}

function browserToolName(tool: WorkbenchBrowserTool): string {
  return `${qualifiedServer}__${tool}`
}
