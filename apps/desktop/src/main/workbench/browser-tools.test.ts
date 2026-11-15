// 负责验证会话浏览器工具：审批策略按 SDK 字段声明、页面按会话隔离、失败时返回错误内容而不抛出。
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  CanUseTool,
  createSdkMcpServer,
  McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk"
import type { WebContents } from "electron"
import type { AgentBrowserScope } from "../../workbench-contract"
import type { BrowserApprovalPort } from "../session/browser-tool-approval"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "../session/claude-agent-adapter"
import { FakeQuery } from "../session/claude-agent-adapter-fixtures"
import { createHarness } from "../session/session-host-fixtures"
import type { SessionPermissionMode } from "../session/session-types"
import { connectBrowserClient, withoutAttribution } from "./browser-approval-mcp-fixture"
import type { WorkbenchBrowsers } from "./browser-surface"
import { browserSessionTools as createBrowserSessionTools } from "./browser-tools"

type CreateSdkMcpServerOptions = Parameters<typeof createSdkMcpServer>[0]

const { servers, windows } = vi.hoisted(() => ({
  servers: [] as CreateSdkMcpServerOptions[],
  windows: new Map<unknown, object>(),
}))

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: (contents: unknown) => windows.get(contents) ?? null },
}))

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()
  return {
    ...actual,
    createSdkMcpServer: (options: CreateSdkMcpServerOptions) => {
      servers.push(options)
      return actual.createSdkMcpServer(options)
    },
  }
})

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] }
const approved: BrowserApprovalPort = {
  denial: () => null,
  rememberCaller: () => undefined,
  request: async () => true,
}

function owner(destroyed = false): WebContents {
  const contents = { isDestroyed: () => destroyed } as unknown as WebContents
  windows.set(contents, { id: windows.size + 1 })
  return contents
}

function browsers(agentPage: WorkbenchBrowsers["agentPage"]): WorkbenchBrowsers {
  return { agentPage } as unknown as WorkbenchBrowsers
}

function browserSessionTools(
  contents: WebContents,
  views: WorkbenchBrowsers,
  canUse: () => boolean,
  approval: BrowserApprovalPort,
  sessionId = "session-test",
) {
  return createBrowserSessionTools(contents, views, canUse, approval, {
    id: "agent-" + randomUUID(),
    sessionId,
  })
}

async function call(
  name: string,
  args: Record<string, unknown> = {},
  extra = {},
): Promise<ToolResult> {
  const definition = servers.at(-1)?.tools?.find((item) => item.name === name)
  if (!definition) throw new Error(`tool not registered: ${name}`)
  return (await definition.handler(args, extra)) as ToolResult
}

beforeEach(() => {
  servers.length = 0
  windows.clear()
})

describe("browser session tools", () => {
  it("tells the model which resource limit prevented the approved browser from opening", async () => {
    const view = vi.fn(async () => {
      throw new Error("WORKBENCH_BROWSER_LIMIT")
    })
    browserSessionTools(owner(), browsers(view), () => true, approved)
    const result = await call("browser_open", { url: target })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/12.+Close a browser tab/)
  })

  it("does not touch the page until the invocation has been approved", async () => {
    let answer: (allow: boolean) => void = () => undefined
    const request = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    const agentPage = vi.fn(async () => "approved page")
    browserSessionTools(owner(), browsers(agentPage), () => true, {
      request,
      denial: () => null,
      rememberCaller: () => undefined,
    })

    const invocation = call("browser_open", { url: "http://127.0.0.1:5173/" })
    expect(request).toHaveBeenCalledWith(
      { kind: "open", url: "http://127.0.0.1:5173/" },
      undefined,
      undefined,
    )
    expect(agentPage).not.toHaveBeenCalled()

    answer(true)
    expect(await invocation).toEqual({ content: [{ type: "text", text: "approved page" }] })
    expect(agentPage).toHaveBeenCalledOnce()
  })

  it("declares both read-only browser tools as always asking the host before each call", () => {
    const config = browserSessionTools(
      owner(),
      browsers(async () => ""),
      () => true,
      approved,
    )

    expect(Object.keys(config)).toEqual(["pigclaude_workbench"])
    expect(config.pigclaude_workbench?.type).toBe("sdk")
    expect(config.pigclaude_workbench?.tools).toEqual([
      { name: "browser_open", permission_policy: "always_ask" },
      { name: "browser_snapshot", permission_policy: "always_ask" },
    ])
    expect(servers.at(-1)?.tools?.map((tool) => tool.name)).toEqual([
      "browser_open",
      "browser_snapshot",
    ])
    expect(servers.at(-1)?.tools?.every((tool) => tool.annotations?.destructiveHint)).toBe(true)
  })

  it("opens the requested page and reads it back in the same session browser", async () => {
    const contents = owner()
    const agentPage = vi.fn(async (_window: unknown, _scope: AgentBrowserScope, url?: string) =>
      url ? `Opened ${url}` : "Current page",
    )
    browserSessionTools(contents, browsers(agentPage), () => true, approved)

    await expect(call("browser_open", { url: "http://127.0.0.1:5173/" })).resolves.toEqual({
      content: [{ type: "text", text: "Opened http://127.0.0.1:5173/" }],
    })
    await expect(call("browser_snapshot")).resolves.toEqual({
      content: [{ type: "text", text: "Current page" }],
    })
    const [first, second] = agentPage.mock.calls
    expect(first?.[0]).toBe(windows.get(contents))
    expect(first?.[1]).toMatchObject({
      id: expect.stringMatching(/^agent-[0-9a-f-]{36}$/),
      sessionId: "session-test",
    })
    expect(second?.[1]).toEqual(first?.[1])
    expect(second?.[2]).toBeUndefined()
  })

  it("gives each conversation its own browser page", async () => {
    const agentPage = vi.fn(async () => "page")
    browserSessionTools(owner(), browsers(agentPage), () => true, approved)
    await call("browser_snapshot")
    browserSessionTools(owner(), browsers(agentPage), () => true, approved)
    await call("browser_snapshot")

    const [first, second] = agentPage.mock.calls.map((args: unknown[]) => args[1])
    expect(first).not.toBe(second)
  })

  it("returns an error result without touching the browser when membership is inactive", async () => {
    const agentPage = vi.fn(async () => "secret page")
    browserSessionTools(owner(), browsers(agentPage), () => false, approved)

    const result = await call("browser_open", { url: "http://localhost:3000/" })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/local preview is unavailable/)
    expect(agentPage).not.toHaveBeenCalled()
  })

  it("returns an error result when the window is gone or the page cannot be read", async () => {
    const agentPage = vi.fn(async () => "page")
    browserSessionTools(owner(true), browsers(agentPage), () => true, approved)
    expect((await call("browser_snapshot")).isError).toBe(true)
    expect(agentPage).not.toHaveBeenCalled()

    const failing = vi.fn(async () => {
      throw new Error("PREVIEW_URL_NOT_ALLOWED: https://example.com/internal")
    })
    browserSessionTools(owner(), browsers(failing), () => true, approved)
    const result = await call("browser_open", { url: "https://example.com/" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toContain("example.com")
  })
})

const fullOpen = "mcp__pigclaude_workbench__browser_open"
const fullSnapshot = "mcp__pigclaude_workbench__browser_snapshot"
const target = "http://127.0.0.1:5173/local"
const approvals: Array<() => Promise<void>> = []

afterEach(async () => {
  while (approvals.length > 0) await approvals.pop()?.()
})

function sdkRequest(server = { name: "pigclaude_workbench", source: "sdk" }) {
  return {
    signal: new AbortController().signal,
    requestId: "sdk-request",
    toolUseID: "sdk-tool",
    mcpServer: server,
  }
}

async function startBrowserSession(permissionMode: SessionPermissionMode, unattended = false) {
  const workspace = await mkdtemp(join(tmpdir(), "pigclaude-browser-approval-"))
  const query = new FakeQuery()
  const sdk: { canUseTool?: CanUseTool; browser?: McpSdkServerConfigWithInstance } = {}
  const harness = createHarness({
    workspace,
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ options }) => {
          if (options.canUseTool) sdk.canUseTool = options.canUseTool
          const server = options.mcpServers?.pigclaude_workbench
          if (server?.type === "sdk" && "instance" in server) sdk.browser = server
          return query
        },
      }),
  })
  approvals.push(async () => {
    await harness.host.dispose()
    await rm(workspace, { recursive: true, force: true })
  })
  const view = vi.fn(async () => "local page text")
  const contents = owner()
  const { sessionId } = await harness.host.start(
    { workspace, permissionMode },
    {
      browser: {
        unattended,
        create: (approval, id) =>
          browserSessionTools(contents, browsers(view), () => true, approval, id),
      },
      close: () => undefined,
    },
  )
  const canUseTool = sdk.canUseTool
  if (!canUseTool) throw new Error("假 SDK 没有拿到权限入口")
  const cards = () => harness.events.filter((event) => event.type === "permission")
  return {
    ...harness,
    sessionId,
    view,
    query,
    hasBrowser: sdk.browser !== undefined,
    connect: () => connectBrowserClient(sdk.browser, (close) => approvals.push(close)),
    canUseTool,
    cards,
    respond: async (decision: "allow" | "deny") => {
      const card = cards().at(-1)
      if (!card) throw new Error("等待审批时没有权限卡")
      await harness.host.respondPermission(sessionId, { requestId: card.requestId, decision })
    },
  }
}

describe("browser tools through a session with a fake SDK", () => {
  it.each(["default", "acceptEdits", "auto", "bypassPermissions"] as const)(
    "%s asks once per invocation even when the SDK does not ask",
    async (mode) => {
      const session = await startBrowserSession(mode)
      expect(session.hasBrowser).toBe(true)
      expect(await session.canUseTool(fullOpen, { url: target }, sdkRequest())).toMatchObject({
        behavior: "allow",
      })
      expect(session.cards()).toHaveLength(0)

      const first = call("browser_open", { url: target })
      expect(session.cards()).toHaveLength(1)
      const request = session.cards().at(-1)
      if (!request) throw new Error("等待审批时没有权限卡")
      expect(request.browser).toEqual({ kind: "open", url: target })
      expect(request.suggestions).toBeUndefined()
      expect(session.view).not.toHaveBeenCalled()
      for (const scope of ["session", "project"] as const) {
        await expect(
          session.host.respondPermission(session.sessionId, {
            decision: "allow",
            requestId: request.requestId,
            suggestion: { index: 0, scope },
          }),
        ).rejects.toThrow("INVALID_SESSION_INPUT")
      }
      await session.respond("allow")
      expect(await first).toEqual({ content: [{ type: "text", text: "local page text" }] })
      expect(session.view).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          id: expect.stringMatching(/^agent-/),
          sessionId: session.sessionId,
        }),
        target,
      )

      const second = call("browser_open", { url: target })
      expect(session.cards()).toHaveLength(2)
      expect(session.view).toHaveBeenCalledOnce()
      await session.respond("deny")
      expect((await second).isError).toBe(true)
      expect(session.view).toHaveBeenCalledOnce()
    },
  )

  it("only bypasses the SDK prompt for the registered in-process service", async () => {
    const session = await startBrowserSession("default")
    const spoofed = session.canUseTool(
      fullOpen,
      { url: target },
      {
        ...sdkRequest({ name: "pigclaude_workbench", source: "project" }),
        suggestions: [
          {
            type: "addRules",
            rules: [{ toolName: fullOpen }],
            behavior: "allow",
            destination: "session",
          },
        ],
      },
    )
    expect(session.cards()).toHaveLength(1)
    expect(session.cards()[0]?.browser).toBeUndefined()
    expect(session.cards()[0]?.suggestions).toBeUndefined()
    await session.respond("deny")
    expect(await spoofed).toMatchObject({ behavior: "deny" })
    expect(session.view).not.toHaveBeenCalled()
  })

  it("only offers snapshots in plan mode and ignores non-loopback targets", async () => {
    const session = await startBrowserSession("plan")
    expect(await session.canUseTool(fullOpen, { url: target }, sdkRequest())).toMatchObject({
      behavior: "deny",
    })
    expect((await call("browser_open", { url: target })).isError).toBe(true)
    expect((await call("browser_open", { url: "https://example.test/" })).isError).toBe(true)
    expect(session.cards()).toHaveLength(0)
    expect(session.view).not.toHaveBeenCalled()
    expect(await session.canUseTool(fullSnapshot, {}, sdkRequest())).toMatchObject({
      behavior: "allow",
    })
    const snapshot = call("browser_snapshot")
    expect(session.cards()).toHaveLength(1)
    expect(session.cards()[0]?.browser).toEqual({ kind: "snapshot" })
    await session.respond("allow")
    expect((await snapshot).isError).toBeUndefined()
    expect(session.view).toHaveBeenCalledOnce()
  })

  it("denies both the SDK and the tool handler when the SDK reports dontAsk", async () => {
    const session = await startBrowserSession("default")
    session.query.emit({
      type: "system",
      subtype: "status",
      status: null,
      permissionMode: "dontAsk",
      session_id: session.sessionId,
      uuid: "10000000-0000-0000-0000-000000000000",
    })
    await vi.waitFor(async () =>
      expect(await session.canUseTool(fullSnapshot, {}, sdkRequest())).toMatchObject({
        behavior: "deny",
      }),
    )
    expect((await call("browser_snapshot")).isError).toBe(true)
    expect(session.cards()).toHaveLength(0)
    expect(session.view).not.toHaveBeenCalled()
  })

  it("does not register or approve browser tools for unattended sessions", async () => {
    const session = await startBrowserSession("bypassPermissions", true)
    expect(session.hasBrowser).toBe(false)
    expect(servers).toHaveLength(0)
    expect(await session.canUseTool(fullSnapshot, {}, sdkRequest())).toMatchObject({
      behavior: "deny",
    })
    expect(session.cards()).toHaveLength(0)
  })

  it("discards an approval when the session switches to plan before the tool runs", async () => {
    const session = await startBrowserSession("default")
    const pending = call("browser_open", { url: target })
    expect(session.cards()).toHaveLength(1)
    await session.host.setMode(session.sessionId, "plan")
    await session.respond("allow")
    expect((await pending).isError).toBe(true)
    expect(session.view).not.toHaveBeenCalled()
  })
})

it("浏览器通过真实 MCP 为并发同参数审批保留一次性、按会话和工具隔离的归属", async () => {
  const session = await startBrowserSession("bypassPermissions")
  const client = await session.connect()
  const other = await startBrowserSession("bypassPermissions")
  const remote = await other.connect()
  await session.host.send(session.sessionId, { text: "读取本机合成页面" })
  const input = { url: target }
  const one = { agentId: "browser-agent-one", parentToolUseId: "browser-parent-one" }
  const two = { agentId: "browser-agent-two", parentToolUseId: "browser-parent-two" }
  const metadata = (index: number) => ({ "claudecode/toolUseId": "browser-invocation-" + index })
  for (const [index, agent] of [one, two].entries()) {
    session.query.emit({
      type: "system",
      subtype: "task_started",
      task_id: agent.agentId,
      tool_use_id: agent.parentToolUseId,
      description: "读取本机合成页面",
      task_type: "local_agent",
      uuid: randomUUID(),
      session_id: session.sessionId,
    })
    await expect(
      session.canUseTool(fullOpen, input, {
        ...sdkRequest(),
        toolUseID: metadata(index)["claudecode/toolUseId"],
        agentID: agent.agentId,
      }),
    ).resolves.toMatchObject({ behavior: "allow" })
  }
  expect(session.cards()).toHaveLength(0)
  const open = (index: number) => ({
    name: "browser_open",
    arguments: input,
    _meta: metadata(index),
  })
  await withoutAttribution(client, session, {
    name: "browser_snapshot",
    arguments: {},
    _meta: metadata(0),
  })
  await withoutAttribution(remote, other, open(0))
  await withoutAttribution(client, session, { name: "browser_open", arguments: input })

  const second = client.callTool(open(1))
  void second.catch(() => undefined)
  await vi.waitFor(() => expect(session.cards()).toHaveLength(3))
  const first = client.callTool(open(0))
  void first.catch(() => undefined)
  await vi.waitFor(() => expect(session.cards()).toHaveLength(4))
  const [secondCard, firstCard] = session.cards().slice(2)
  if (!secondCard || !firstCard) throw new Error("缺少工作台的子代理审批卡")
  expect([secondCard.subagent, firstCard.subagent]).toEqual([two, one])
  expect(session.view).not.toHaveBeenCalled()
  await session.host.respondPermission(session.sessionId, {
    requestId: firstCard.requestId,
    decision: "deny",
  })
  await session.host.respondPermission(session.sessionId, {
    requestId: secondCard.requestId,
    decision: "allow",
  })
  await expect(first).resolves.toMatchObject({ isError: true })
  await expect(second).resolves.toMatchObject({
    content: [{ type: "text", text: "local page text" }],
  })
  expect(session.view).toHaveBeenCalledTimes(1)
  await withoutAttribution(client, session, open(1))
})
