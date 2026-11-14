// 提供会话专用的本机预览工具；使用 SDK 自带的权限审批。
import { randomUUID } from "node:crypto"
import { BrowserWindow, type WebContents } from "electron"
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type McpServerToolPolicy,
} from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"
import type { WorkbenchBrowsers } from "./browser-surface"

/** 将浏览器工具限定到此次会话的主窗口和临时浏览器；不共享个人浏览器会话，每个工具调用前都询问宿主。 */
export function browserSessionTools(
  owner: WebContents,
  browsers: WorkbenchBrowsers,
  canUse: () => boolean,
): Record<string, McpSdkServerConfigWithInstance> {
  const id = randomUUID()
  async function run(url?: string) {
    const window = owner.isDestroyed() ? null : BrowserWindow.fromWebContents(owner)
    try {
      if (!window || !canUse()) throw new Error("MEMBERSHIP_REQUIRED")
      const content = await browsers.agentPage(window, id, url)
      return { content: [{ type: "text" as const, text: content }] }
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "The local preview is unavailable. Use an HTTP(S) loopback development page.",
          },
        ],
      }
    }
  }

  const tools = [
    tool(
      "browser_open",
      "Open a local development page in this conversation's PigClaude browser and return its visible text. Use only URLs on localhost or loopback.",
      { url: z.string().max(4096) },
      ({ url }) => run(url),
    ),
    tool(
      "browser_snapshot",
      "Read the title and visible text of this conversation's local preview.",
      {},
      () => run(),
    ),
  ]
  const server = createSdkMcpServer({ name: "pigclaude_workbench", tools })
  const toolPolicies: McpServerToolPolicy[] = tools.map(({ name }) => ({
    name,
    permission_policy: "always_ask",
  }))
  return { pigclaude_workbench: { ...server, tools: toolPolicies } }
}
