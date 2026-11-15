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
import {
  browserTypeTextLimit,
  type BrowserPermissionContext,
} from "../../browser-permission-contract"
import {
  browserToolForContext,
  workbenchBrowserServer,
  type BrowserApprovalPort,
  type WorkbenchBrowserTool,
} from "../session/browser-tool-approval"
import { BrowserActionError, type PreparedBrowserAction } from "./browser-action-request"
import { workbenchAgentBrowserUrl, type WorkbenchBrowsers } from "./browser-surface"

const unavailableMessage =
  "The local preview is unavailable. Use an HTTP(S) loopback development page."
const passwordEchoFields = new Set(["url", "title", "text", "name"])

type BrowserAction = {
  context: BrowserPermissionContext
  execute: PreparedBrowserAction["execute"]
}

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
  async function run(
    actionTool: WorkbenchBrowserTool,
    extra: unknown,
    prepare: (window: BrowserWindow) => BrowserAction | Promise<BrowserAction>,
    typedText?: string,
  ) {
    const invocation = record(extra)
    const signal = invocation?.signal instanceof AbortSignal ? invocation.signal : undefined
    const window = owner.isDestroyed() ? null : BrowserWindow.fromWebContents(owner)
    const assertAllowed = () => {
      if (owner.isDestroyed() || signal?.aborted || !canUse())
        throw new BrowserActionError(unavailableMessage)
      const denied = approval.denial(actionTool)
      if (denied !== null) throw new BrowserActionError(denied)
    }
    try {
      if (!window) return unavailable()
      assertAllowed()
      const action = await prepare(window)
      if (browserToolForContext(action.context) !== actionTool) return unavailable()
      assertAllowed()
      const metadata = record(invocation?._meta)
      const approved =
        typedText === undefined
          ? await approval.request(action.context, signal, metadata)
          : await approval.request(action.context, signal, metadata, { text: typedText })
      if (!approved) return failure("The user did not approve this browser action.")

      assertAllowed()
      const snapshot = await action.execute(signal, assertAllowed)
      assertAllowed()
      const text =
        action.context.kind === "type" && action.context.isPassword && typedText !== undefined
          ? maskPasswordEcho(snapshot, typedText)
          : snapshot
      return { content: [{ type: "text" as const, text }] }
    } catch (error) {
      return error instanceof BrowserActionError ? failure(error.message) : unavailable()
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
            execute: () => browsers.agentPage(window, id, target),
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
          execute: () => browsers.agentPage(window, id),
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
            browsers.prepareAgentNavigation(window, id, { url }),
          )
        if (url === undefined && action !== undefined)
          return run("browser_navigate", extra, (window) =>
            browsers.prepareAgentNavigation(window, id, { action }),
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
        run("browser_click", extra, (window) => browsers.prepareAgentClick(window, id, ref)),
      { annotations: { destructiveHint: true } },
    ),
    tool(
      "browser_type",
      "Type into an editable element in this conversation's local preview using a ref from its latest snapshot. Optionally clear it first or press Enter after typing. Returns the updated snapshot after approval.",
      {
        ref: z.string().min(1).max(64),
        // JSON Schema 的 maxLength 按码点计数，原生输入的上限按 UTF-16 代码单元复核。
        text: z
          .string()
          .max(browserTypeTextLimit)
          .refine(
            (value) => value.length <= browserTypeTextLimit,
            `Browser input must be at most ${browserTypeTextLimit} UTF-16 code units.`,
          ),
        clear: z.boolean().optional(),
        submit: z.boolean().optional(),
      },
      ({ ref, text, clear = false, submit = false }, extra) =>
        run(
          "browser_type",
          extra,
          (window) => browsers.prepareAgentType(window, id, { ref, text, clear, submit }),
          text,
        ),
      { annotations: { destructiveHint: true } },
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

function maskPasswordEcho(snapshot: string, text: string): string {
  if (text === "") return snapshot
  // 快照会压缩可见文本中的空白，引用和角色等结构字段保持原样。
  const visibleText = text.replace(/\s+/g, " ").trim()
  const masked: unknown = JSON.parse(snapshot, (key, value: unknown) => {
    if (typeof value !== "string" || !passwordEchoFields.has(key)) return value
    const redacted = value.replaceAll(text, "••••")
    return visibleText && visibleText !== text && key !== "url"
      ? redacted.replaceAll(visibleText, "••••")
      : redacted
  })
  if (!record(masked))
    throw new BrowserActionError(
      "The browser did not return a valid snapshot. Take a new snapshot.",
    )
  return JSON.stringify(masked)
}

function unavailable() {
  return failure(unavailableMessage)
}

function failure(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] }
}
