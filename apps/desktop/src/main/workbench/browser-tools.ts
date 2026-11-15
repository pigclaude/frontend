// 提供会话专用的本机预览工具；每次调用先由会话的权限代理审批。
import { randomUUID } from "node:crypto"
import { BrowserWindow, type WebContents } from "electron"
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type McpServerToolPolicy,
} from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import type { BrowserPermissionContext } from "../../browser-permission-contract"
import { workbenchBrowserServer, type BrowserApprovalPort } from "../session/browser-tool-approval"
import { workbenchAgentBrowserUrl, type WorkbenchBrowsers } from "./browser-surface"

/**
 * 将浏览器工具限定到此次会话的主窗口和临时浏览器；不共享个人浏览器会话，每个工具调用前都询问宿主。
 * id 是这个会话的浏览器标签 id，关闭时用它找到这个会话的浏览器。
 */
export function browserSessionTools(
  owner: WebContents,
  browsers: WorkbenchBrowsers,
  canUse: () => boolean,
  approval: BrowserApprovalPort,
  id: string = randomUUID(),
): Record<string, McpSdkServerConfigWithInstance> {
  async function run(context: BrowserPermissionContext, extra: unknown) {
    const invocation = record(extra)
    const signal = invocation?.signal instanceof AbortSignal ? invocation.signal : undefined
    const window = owner.isDestroyed() ? null : BrowserWindow.fromWebContents(owner)
    try {
      if (!window || !canUse()) return unavailable()
      const tool = context.kind === "open" ? "browser_open" : "browser_snapshot"
      const denied = approval.denial(tool)
      if (denied !== null) return failure(denied)
      if (!(await approval.request(context, signal, record(invocation?._meta))))
        return failure("The user did not approve this browser action.")
      if (owner.isDestroyed() || !canUse() || signal?.aborted) return unavailable()
      const content = await browsers.agentPage(
        window,
        id,
        context.kind === "open" ? context.url : undefined,
      )
      if (owner.isDestroyed() || !canUse() || signal?.aborted) return unavailable()
      return { content: [{ type: "text" as const, text: content }] }
    } catch {
      return unavailable()
    }
  }

  const tools = [
    tool(
      "browser_open",
      "Open a local development page in this conversation's PigClaude browser and return its visible text. Use only URLs on localhost or loopback.",
      { url: z.string().max(4096) },
      async ({ url }, extra) => {
        try {
          return run({ kind: "open", url: workbenchAgentBrowserUrl(url).href }, extra)
        } catch {
          return unavailable()
        }
      },
      { annotations: { destructiveHint: true } },
    ),
    tool(
      "browser_snapshot",
      "Read the title and visible text of this conversation's local preview.",
      {},
      (_input, extra) => run({ kind: "snapshot" }, extra),
      { annotations: { destructiveHint: true, readOnlyHint: true } },
    ),
  ]
  const server = createSdkMcpServer({ name: workbenchBrowserServer, tools })
  const toolPolicies: McpServerToolPolicy[] = tools.map(({ name }) => ({
    name,
    permission_policy: "always_ask",
  }))
  return { [workbenchBrowserServer]: { ...server, tools: toolPolicies } }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function unavailable() {
  return failure("The local preview is unavailable. Use an HTTP(S) loopback development page.")
}

function failure(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] }
}
