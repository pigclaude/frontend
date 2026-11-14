// 负责验证会话浏览器工具：审批策略按 SDK 字段声明、页面按会话隔离、失败时返回错误内容而不抛出。
import type { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import type { WebContents } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkbenchBrowsers } from "./browser-surface"
import { browserSessionTools } from "./browser-tools"

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

function owner(destroyed = false): WebContents {
  const contents = { isDestroyed: () => destroyed } as unknown as WebContents
  windows.set(contents, { id: windows.size + 1 })
  return contents
}

function browsers(agentPage: WorkbenchBrowsers["agentPage"]): WorkbenchBrowsers {
  return { agentPage } as unknown as WorkbenchBrowsers
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const definition = servers.at(-1)?.tools?.find((item) => item.name === name)
  if (!definition) throw new Error(`tool not registered: ${name}`)
  return (await definition.handler(args, {})) as ToolResult
}

beforeEach(() => {
  servers.length = 0
  windows.clear()
})

describe("browser session tools", () => {
  it("declares both read-only browser tools as always asking the host before each call", () => {
    const config = browserSessionTools(
      owner(),
      browsers(async () => ""),
      () => true,
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
  })

  it("opens the requested page and reads it back in the same session browser", async () => {
    const contents = owner()
    const agentPage = vi.fn(async (_window: unknown, _id: string, url?: string) =>
      url ? `Opened ${url}` : "Current page",
    )
    browserSessionTools(contents, browsers(agentPage), () => true)

    await expect(call("browser_open", { url: "http://127.0.0.1:5173/" })).resolves.toEqual({
      content: [{ type: "text", text: "Opened http://127.0.0.1:5173/" }],
    })
    await expect(call("browser_snapshot")).resolves.toEqual({
      content: [{ type: "text", text: "Current page" }],
    })
    const [first, second] = agentPage.mock.calls
    expect(first?.[0]).toBe(windows.get(contents))
    expect(first?.[1]).toMatch(/^[0-9a-f-]{36}$/)
    expect(second?.[1]).toBe(first?.[1])
    expect(second?.[2]).toBeUndefined()
  })

  it("gives each conversation its own browser page", async () => {
    const agentPage = vi.fn(async () => "page")
    browserSessionTools(owner(), browsers(agentPage), () => true)
    await call("browser_snapshot")
    browserSessionTools(owner(), browsers(agentPage), () => true)
    await call("browser_snapshot")

    const [first, second] = agentPage.mock.calls.map((args: unknown[]) => args[1])
    expect(first).not.toBe(second)
  })

  it("returns an error result without touching the browser when membership is inactive", async () => {
    const agentPage = vi.fn(async () => "secret page")
    browserSessionTools(owner(), browsers(agentPage), () => false)

    const result = await call("browser_open", { url: "http://localhost:3000/" })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/local preview is unavailable/)
    expect(agentPage).not.toHaveBeenCalled()
  })

  it("returns an error result when the window is gone or the page cannot be read", async () => {
    const agentPage = vi.fn(async () => "page")
    browserSessionTools(owner(true), browsers(agentPage), () => true)
    expect((await call("browser_snapshot")).isError).toBe(true)
    expect(agentPage).not.toHaveBeenCalled()

    const failing = vi.fn(async () => {
      throw new Error("PREVIEW_URL_NOT_ALLOWED: https://example.com/internal")
    })
    browserSessionTools(owner(), browsers(failing), () => true)
    const result = await call("browser_open", { url: "https://example.com/" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).not.toContain("example.com")
  })
})
