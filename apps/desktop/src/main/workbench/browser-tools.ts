// 提供会话专用的本机预览工具；每次调用先由会话的权限代理审批。
import { BrowserWindow, type WebContents } from "electron"
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type McpServerToolPolicy,
} from "@anthropic-ai/claude-agent-sdk"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import type { BrowserPermissionContext } from "../../browser-permission-contract"
import type { AgentBrowserScope } from "../../workbench-contract"
import {
  browserToolForContext,
  workbenchBrowserServer,
  type BrowserApprovalPort,
  type WorkbenchBrowserTool,
} from "../session/browser-tool-approval"
import { BrowserActionError } from "./browser-action-request"
import { BrowserScreenshotError } from "./browser-screenshot"
import { workbenchAgentBrowserUrl, type WorkbenchBrowsers } from "./browser-surface"

type BrowserAction = {
  context: BrowserPermissionContext
  execute(
    signal?: AbortSignal,
    assertAllowed?: () => void,
  ): Promise<string | CallToolResult["content"]>
}

/**
 * 将浏览器工具限定到此次会话的主窗口和临时浏览器；不共享个人浏览器会话，每个工具调用前都询问宿主。
 * scope 由会话宿主创建，导航、读取和捕获都使用同一个会话与标签绑定。
 */
export function browserSessionTools(
  owner: WebContents,
  browsers: WorkbenchBrowsers,
  canUse: () => boolean,
  approval: BrowserApprovalPort,
  scope: AgentBrowserScope,
): Record<string, McpSdkServerConfigWithInstance> {
  async function run(
    actionTool: WorkbenchBrowserTool,
    extra: unknown,
    prepare: (
      window: BrowserWindow,
      signal?: AbortSignal,
    ) => BrowserAction | Promise<BrowserAction>,
  ): Promise<CallToolResult> {
    const invocation = record(extra)
    const signal = invocation?.signal instanceof AbortSignal ? invocation.signal : undefined
    const window = owner.isDestroyed() ? null : BrowserWindow.fromWebContents(owner)
    const active = () => !owner.isDestroyed() && !signal?.aborted && canUse()
    const assertAllowed = () => {
      if (!active()) throw new BrowserActionError("The browser is unavailable for this session.")
      const denied = approval.denial(actionTool)
      if (denied !== null) throw new BrowserActionError(denied)
    }
    try {
      if (!window || !active()) return unavailable()
      const denied = approval.denial(actionTool)
      if (denied !== null) return failure(denied)

      const action = await prepare(window, signal)
      if (!active() || browserToolForContext(action.context) !== actionTool) return unavailable()
      if (!(await approval.request(action.context, signal, record(invocation?._meta))))
        return failure("The user did not approve this browser action.")
      assertAllowed()
      const content = await action.execute(signal, assertAllowed)
      if (!active()) return unavailable()
      return { content: typeof content === "string" ? [{ type: "text", text: content }] : content }
    } catch (error) {
      if (error instanceof BrowserActionError || error instanceof BrowserScreenshotError)
        return failure(error.message)
      if (error instanceof Error && error.message === "WORKBENCH_BROWSER_LIMIT")
        return failure(
          "The shared limit of 12 workbench browsers is reached. Close a browser tab and try again.",
        )
      if (actionTool === "browser_screenshot")
        return failure(
          "Couldn't capture this local page. Reload the Agent browser tab and try again.",
        )
      return unavailable()
    }
  }

  const tools = [
    tool(
      "browser_open",
      "Open a local development page in this conversation's PigClaude browser and return its visible text. Use only URLs on localhost or loopback.",
      { url: z.string().max(4096) },
      ({ url }, extra) =>
        run("browser_open", extra, (window) => {
          const target = workbenchAgentBrowserUrl(url).href
          return {
            context: { kind: "open", url: target },
            execute: (_signal, assertAllowed) =>
              browsers.agentPage(window, scope, target, assertAllowed),
          }
        }),
      { annotations: { destructiveHint: true } },
    ),
    tool(
      "browser_snapshot",
      "Read the title and visible text of this conversation's local preview.",
      {},
      (_input, extra) =>
        run("browser_snapshot", extra, (window) => ({
          context: { kind: "snapshot" },
          execute: (_signal, assertAllowed) =>
            browsers.agentPage(window, scope, undefined, assertAllowed),
        })),
      { annotations: { destructiveHint: true, readOnlyHint: true } },
    ),
    tool(
      "browser_navigate",
      "Navigate this conversation's local preview to a loopback URL or go back, forward, or reload. Returns the latest browser snapshot after approval.",
      {
        url: z.string().max(4096).optional(),
        action: z.enum(["back", "forward", "reload"]).optional(),
      },
      async ({ url, action }, extra) => {
        if (url !== undefined && action === undefined)
          return run("browser_navigate", extra, (window) =>
            browsers.prepareAgentNavigation(window, scope, { url }),
          )
        if (url === undefined && action !== undefined)
          return run("browser_navigate", extra, (window) =>
            browsers.prepareAgentNavigation(window, scope, { action }),
          )
        return failure("Provide one local URL or choose back, forward, or reload.")
      },
      { annotations: { destructiveHint: true } },
    ),
    tool(
      "browser_click",
      "Click an element in this conversation's local preview using a ref from its latest snapshot. Returns the updated snapshot after approval.",
      { ref: z.string().min(1).max(64) },
      ({ ref }, extra) =>
        run("browser_click", extra, (window) => browsers.prepareAgentClick(window, scope, ref)),
      { annotations: { destructiveHint: true } },
    ),
    tool(
      "browser_screenshot",
      "Capture the visible region of the current local Agent page as a JPEG after approval.",
      {},
      (_input, extra) =>
        run("browser_screenshot", extra, async (window, signal) => {
          const { context, capture } = await browsers.prepareAgentScreenshot(
            window,
            scope,
            signal,
            () =>
              !owner.isDestroyed() && canUse() && approval.denial("browser_screenshot") === null,
          )
          return {
            context,
            async execute(invocation) {
              const image = await capture(invocation)
              return [
                {
                  type: "text",
                  text: `Browser screenshot (${context.width} × ${context.height}).`,
                },
                image,
              ]
            },
          }
        }),
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
