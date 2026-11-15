// 通过真实内存 MCP 和假会话 SDK 验证浏览器导航、点击及逐次审批的授权边界。
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CanUseTool, McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk"
import type { BrowserWindow, WebContents } from "electron"
import { afterEach, expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "../session/claude-agent-adapter"
import { FakeQuery } from "../session/claude-agent-adapter-fixtures"
import { createHarness } from "../session/session-host-fixtures"
import type { SessionPermissionMode } from "../session/session-types"
import { syntheticJpegBase64 } from "../../test-support/synthetic-jpeg"
import { BrowserActionError, type PreparedBrowserAction } from "./browser-action-request"
import { connectBrowserClient } from "./browser-approval-mcp-fixture"
import type { PreparedBrowserScreenshot } from "./browser-screenshot"
import type { WorkbenchBrowsers } from "./browser-surface"
import { browserSessionTools } from "./browser-tools"

const native = vi.hoisted(() => new Map<unknown, object>())
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: (contents: unknown) => native.get(contents) ?? null },
}))

const shutdown: Array<() => Promise<void>> = []
const target = "http://127.0.0.1:5173/verified"
const ref = "fixture-ref"
const clickContext = {
  kind: "click",
  url: target,
  ref,
  role: "button",
  name: "Verified synthetic action",
} as const
const historyContext = { kind: "navigate", action: "back", url: target } as const
const screenshotContext = { kind: "screenshot", url: target, width: 2, height: 2 } as const
const screenshotImage = {
  type: "image",
  mimeType: "image/jpeg",
  data: syntheticJpegBase64,
} as const

afterEach(async () => {
  while (shutdown.length) await shutdown.pop()?.()
  native.clear()
})

async function fixture(permissionMode: SessionPermissionMode = "default") {
  const workspace = await mkdtemp(join(tmpdir(), "pigclaude-browser-action-mcp-"))
  const query = new FakeQuery()
  const sdk: { authorize?: CanUseTool; server?: McpSdkServerConfigWithInstance } = {}
  const h = createHarness({
    workspace,
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ options }) => {
          if (options.canUseTool) sdk.authorize = options.canUseTool
          const server = options.mcpServers?.pigclaude_workbench
          if (server?.type === "sdk" && "instance" in server) sdk.server = server
          return query
        },
      }),
  })
  shutdown.push(async () => {
    await h.host.dispose()
    await rm(workspace, { recursive: true, force: true })
  })

  const click = vi
    .fn<(signal?: AbortSignal) => Promise<string>>()
    .mockResolvedValue("click snapshot")
  const navigate = vi
    .fn<(signal?: AbortSignal) => Promise<string>>()
    .mockResolvedValue("navigation snapshot")
  const prepareAgentClick = vi.fn(async (): Promise<PreparedBrowserAction> => ({
    context: clickContext,
    execute: click,
  }))
  const prepareAgentNavigation = vi.fn(async (): Promise<PreparedBrowserAction> => ({
    context: historyContext,
    execute: navigate,
  }))
  const capture = vi.fn(async () => screenshotImage)
  const prepareAgentScreenshot = vi.fn(async (): Promise<PreparedBrowserScreenshot> => ({
    context: screenshotContext,
    capture,
  }))
  const browsers = {
    prepareAgentClick,
    prepareAgentNavigation,
    prepareAgentScreenshot,
  } as unknown as WorkbenchBrowsers
  const owner = { isDestroyed: () => false } as unknown as WebContents
  const window = { id: native.size + 1 } as unknown as BrowserWindow
  native.set(owner, window)
  const id = "agent-" + randomUUID()
  let member = true

  const { sessionId } = await h.host.start(
    { workspace, permissionMode },
    {
      browser: {
        create: (approval, sessionId) =>
          browserSessionTools(owner, browsers, () => member, approval, { id, sessionId }),
      },
      close: () => undefined,
    },
  )
  const client = await connectBrowserClient(sdk.server, (close) => shutdown.push(close))
  const canUseTool = sdk.authorize
  if (!canUseTool) throw new Error("缺少假 SDK 的审批入口")
  const cards = () => h.events.filter((event) => event.type === "permission")
  return {
    host: h.host,
    sessionId,
    query,
    client,
    canUseTool,
    id,
    window,
    cards,
    navigate,
    click,
    capture,
    prepareAgentNavigation,
    prepareAgentClick,
    loseMembership: () => {
      member = false
    },
    decide: (requestId: string, decision: "allow" | "deny") =>
      h.host.respondPermission(sessionId, { requestId, decision }),
  }
}

it("先把历史导航的已核对目标交给所属会话审批，批准后才执行并返回快照", async () => {
  const f = await fixture()
  expect((await f.client.listTools()).tools.map(({ name }) => name)).toContain("browser_navigate")
  const invocation = f.client.callTool({ name: "browser_navigate", arguments: { action: "back" } })
  void invocation.catch(() => undefined)
  await vi.waitFor(() => expect(f.cards()).toHaveLength(1))
  expect(f.prepareAgentNavigation).toHaveBeenCalledExactlyOnceWith(
    f.window,
    { id: f.id, sessionId: f.sessionId },
    { action: "back" },
  )
  const [card] = f.cards()
  if (!card) throw new Error("缺少导航审批卡")
  expect(card).toMatchObject({
    toolName: "mcp__pigclaude_workbench__browser_navigate",
    browser: historyContext,
  })
  expect(f.navigate).not.toHaveBeenCalled()

  await f.decide(card.requestId, "allow")
  await expect(invocation).resolves.toMatchObject({
    content: [{ type: "text", text: "navigation snapshot" }],
  })
  expect(f.navigate).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), expect.any(Function))
})

function sdkRequest(toolUseID: string): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID,
    requestId: "fixture-request-" + toolUseID,
    mcpServer: { name: "pigclaude_workbench", source: "sdk" },
  }
}

it("计划档从 SDK 和实际工具入口都拒绝导航和点击", async () => {
  const f = await fixture("plan")
  const actions = [
    ["browser_navigate", { url: target }],
    ["browser_click", { ref }],
  ] as const
  for (const [name, args] of actions) {
    await expect(
      f.canUseTool("mcp__pigclaude_workbench__" + name, args, sdkRequest(name)),
    ).resolves.toMatchObject({ behavior: "deny" })
    await expect(f.client.callTool({ name, arguments: args })).resolves.toMatchObject({
      isError: true,
    })
  }
  expect(f.cards()).toEqual([])
  expect(f.prepareAgentNavigation).not.toHaveBeenCalled()
  expect(f.prepareAgentClick).not.toHaveBeenCalled()
  expect(f.navigate).not.toHaveBeenCalled()
  expect(f.click).not.toHaveBeenCalled()
})

it("计划档的截图仍经实际工具单独审批，批准后才返回 JPEG", async () => {
  const f = await fixture("plan")
  const toolName = "mcp__pigclaude_workbench__browser_screenshot"
  const toolUseID = "plan-screenshot"
  await expect(f.canUseTool(toolName, {}, sdkRequest(toolUseID))).resolves.toMatchObject({
    behavior: "allow",
  })
  expect(f.cards()).toHaveLength(0)
  const call = f.client.callTool({
    name: "browser_screenshot",
    arguments: {},
    _meta: { "claudecode/toolUseId": toolUseID },
  })
  void call.catch(() => undefined)
  await vi.waitFor(() => expect(f.cards()).toHaveLength(1))
  const [card] = f.cards()
  if (!card) throw new Error("缺少截图审批")
  expect(card).toMatchObject({
    toolName,
    browser: screenshotContext,
    input: { width: 2, height: 2 },
  })
  expect(f.capture).not.toHaveBeenCalled()

  await f.decide(card.requestId, "allow")
  await expect(call).resolves.toMatchObject({
    content: [{ type: "text", text: "Browser screenshot (2 × 2)." }, screenshotImage],
  })
  expect(f.capture).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal))
})

it("同参点击各自绑定子代理和目标；会员撤销时批准也不会执行", async () => {
  const f = await fixture("bypassPermissions")
  await f.host.send(f.sessionId, { text: "合成的逐次审批测试" })
  const actors = ["first", "second"].map((id) => ({
    agentId: "click-agent-" + id,
    parentToolUseId: "click-parent-" + id,
  }))
  for (const [index, actor] of actors.entries()) {
    f.query.emit({
      type: "system",
      subtype: "task_started",
      task_id: actor.agentId,
      tool_use_id: actor.parentToolUseId,
      description: "本机合成点击",
      task_type: "local_agent",
      uuid: randomUUID(),
      session_id: f.sessionId,
    })
    await expect(
      f.canUseTool(
        "mcp__pigclaude_workbench__browser_click",
        { ref },
        {
          ...sdkRequest("fixture-click-" + index),
          agentID: actor.agentId,
        },
      ),
    ).resolves.toMatchObject({ behavior: "allow" })
  }
  expect(f.cards()).toHaveLength(0)
  const invoke = (index: number) =>
    f.client.callTool({
      name: "browser_click",
      arguments: { ref },
      _meta: { "claudecode/toolUseId": "fixture-click-" + index },
    })
  const second = invoke(1)
  void second.catch(() => undefined)
  await vi.waitFor(() => expect(f.cards()).toHaveLength(1))
  const first = invoke(0)
  void first.catch(() => undefined)
  await vi.waitFor(() => expect(f.cards()).toHaveLength(2))
  expect(f.cards().map(({ subagent }) => subagent)).toEqual([...actors].reverse())
  expect(f.cards().map(({ browser }) => browser)).toEqual([clickContext, clickContext])
  expect(f.prepareAgentClick.mock.calls).toEqual([
    [f.window, { id: f.id, sessionId: f.sessionId }, ref],
    [f.window, { id: f.id, sessionId: f.sessionId }, ref],
  ])
  expect(f.click).not.toHaveBeenCalled()

  const [secondCard, firstCard] = f.cards()
  if (!secondCard || !firstCard) throw new Error("缺少两张点击审批")
  await f.decide(firstCard.requestId, "allow")
  await expect(first).resolves.toMatchObject({
    content: [{ type: "text", text: "click snapshot" }],
  })
  expect(f.click).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal), expect.any(Function))

  f.loseMembership()
  await f.decide(secondCard.requestId, "allow")
  await expect(second).resolves.toMatchObject({ isError: true })
  expect(f.click).toHaveBeenCalledTimes(1)
})

it("取消真实 MCP 请求关闭待答审批，迟到批准不会点击", async () => {
  const f = await fixture()
  const abort = new AbortController()
  const call = f.client.callTool({ name: "browser_click", arguments: { ref } }, undefined, {
    signal: abort.signal,
  })
  const cancelled = expect(call).rejects.toThrow()
  await vi.waitFor(() => expect(f.host.pendingWork().approvals).toBe(1))
  const [card] = f.cards()
  if (!card) throw new Error("缺少待取消审批")
  abort.abort()
  await cancelled
  await vi.waitFor(() => expect(f.host.pendingWork().approvals).toBe(0))
  await f.decide(card.requestId, "allow")
  expect(f.click).not.toHaveBeenCalled()
})

it("导航必须选一个意向，准备失败返还固定提示且不询问", async () => {
  const f = await fixture()
  await expect(
    f.client.callTool({ name: "browser_navigate", arguments: { url: target, action: "reload" } }),
  ).resolves.toMatchObject({ isError: true })
  await expect(
    f.client.callTool({ name: "browser_navigate", arguments: {} }),
  ).resolves.toMatchObject({ isError: true })
  expect(f.prepareAgentNavigation).not.toHaveBeenCalled()

  const message = "The browser element changed. Please take a new browser snapshot."
  f.prepareAgentClick.mockRejectedValueOnce(new BrowserActionError(message))
  await expect(
    f.client.callTool({ name: "browser_click", arguments: { ref } }),
  ).resolves.toMatchObject({
    isError: true,
    content: [{ type: "text", text: message }],
  })
  expect(f.cards()).toEqual([])
  expect(f.click).not.toHaveBeenCalled()
})
