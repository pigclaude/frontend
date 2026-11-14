// 用自定义 Anthropic 兼容供应商验证 Claude Code CLI 的完整接入：启动、流式文本、工具调用、
// 权限回调、模型目录和结束事件。未设置测试供应商时跳过，不会在普通单测里访问网络。

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import type { AdapterEvent } from "./session-events"
import { SessionEnvironment } from "./session-environment"
import { FakeMembership, FakeRuntime, FakeUsage } from "./session-host-fixtures"
import { SessionHost } from "./session-host"
import type { SessionHostEvent } from "./session-types"

const baseUrl = process.env["PIGCLAUDE_TEST_ANTHROPIC_BASE_URL"]
const authToken = process.env["PIGCLAUDE_TEST_ANTHROPIC_AUTH_TOKEN"]
const model = process.env["PIGCLAUDE_TEST_MODEL"] ?? "claude-haiku-5.5"
const binary = process.env["PIGCLAUDE_CLAUDE_BIN"]

/** 只投递启动 CLI 必需的宿主变量，其余凭据和供应商配置由测试显式提供。 */
function providerEnv(configDir: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "",
    HOME: process.env["HOME"] ?? "",
    CLAUDE_CONFIG_DIR: configDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ANTHROPIC_BASE_URL: baseUrl ?? "",
    ANTHROPIC_AUTH_TOKEN: authToken ?? "",
  }
  for (const name of ["TMPDIR", "LANG", "LC_ALL", "SHELL", "USER"] as const) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

/** 收集一次会话的事件，直到本轮 result 或进程结束；会话本身是长连接，收尾由调用方 stop。 */
async function runPrompt(
  workspace: string,
  prompt: string,
  options: { permissionMode: "default" | "bypassPermissions"; modelId?: string },
): Promise<AdapterEvent[]> {
  const events: AdapterEvent[] = []
  let resolveDone: (() => void) | null = null
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const adapter = new ClaudeAgentAdapter({
    ...(binary === undefined ? {} : { resolveBinaryPath: () => binary }),
    onEvent: (event) => {
      events.push(event)
      if (event.type === "result" || event.type === "ended") resolveDone?.()
    },
  })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    await adapter.start({
      workspace,
      env: providerEnv(join(workspace, "claude-config")),
      permissionMode: options.permissionMode,
      canUseTool: async () => ({ behavior: "allow" }),
      abortController: controller,
      model: options.modelId ?? model,
    })
    await adapter.send(prompt)
    await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 90_000))])
    return events
  } finally {
    clearTimeout(timer)
    await adapter.stop()
  }
}

it.skipIf(!baseUrl || !authToken)(
  "自定义供应商下完成一次文本回复",
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pigclaude-provider-text-"))
    try {
      // 自定义供应商要显式给供应商标注的模型 id；CLI 的 default 会解析成官方模型名。
      const events = await runPrompt(workspace, "Reply with exactly: PIGCLAUDE_OK", {
        permissionMode: "default",
      })
      expect(events[0]).toMatchObject({ type: "started" })
      const text = events
        .filter((event) => event.type === "message")
        .flatMap((event) => event.blocks)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
      expect(text).toContain("PIGCLAUDE_OK")
      expect(events.some((event) => event.type === "result")).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  },
  180_000,
)

it.skipIf(!baseUrl || !authToken)(
  "自定义供应商下写文件并流回工具结果",
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pigclaude-provider-tool-"))
    try {
      const events = await runPrompt(
        workspace,
        "Create a file named pigclaude-smoke.txt in the current directory containing exactly hello, then reply with exactly PIGCLAUDE_DONE.",
        { permissionMode: "bypassPermissions" },
      )
      const tools = events
        .filter((event) => event.type === "message")
        .flatMap((event) => event.blocks)
        .filter((block) => block.type === "tool-use")
      expect(tools.length).toBeGreaterThan(0)
      expect(events.some((event) => event.type === "tool-result")).toBe(true)
      await expect(readFile(join(workspace, "pigclaude-smoke.txt"), "utf8")).resolves.toContain(
        "hello",
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  },
  180_000,
)

it.skipIf(!baseUrl || !authToken)(
  "SessionHost 用自定义供应商完成一次会话并记录用量",
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pigclaude-provider-host-"))
    const userData = await mkdtemp(join(tmpdir(), "pigclaude-provider-userdata-"))
    const usage = new FakeUsage()
    const events: SessionHostEvent[] = []
    const host = new SessionHost({
      membership: new FakeMembership("active"),
      runtime: new FakeRuntime("http://provider.invalid"),
      usage,
      userDataPath: userData,
      resolveBinaryPath: () => binary ?? resolveClaudeBinaryPath(),
      resolveProfile: async () => ({ locale: "en-US", timezone: "UTC" }),
      createAdapter: (onEvent) => new ClaudeAgentAdapter({ onEvent }),
      createEnvironment: async (input) => {
        const sessionDir = join(userData, "sessions", input.sessionId)
        const configDir = join(sessionDir, "claude")
        await mkdir(configDir, { recursive: true })
        return {
          env: providerEnv(configDir),
          configDir,
          sessionDir,
          workspace: input.workspace,
          binaryPath: input.binaryPath,
          timezone: "UTC",
          cleanup: async () => {
            await rm(sessionDir, { recursive: true, force: true })
          },
        }
      },
    })
    host.subscribe((envelope) => events.push(envelope.event))
    let resolveResult: (() => void) | null = null
    const result = new Promise<void>((resolve) => {
      resolveResult = resolve
    })
    const unsubscribe = host.subscribe(({ event }) => {
      if (event.type === "result" || event.type === "ended") resolveResult?.()
    })
    try {
      const { sessionId } = await host.start({
        workspace,
        model,
        permissionMode: "bypassPermissions",
      })
      await host.send(sessionId, { text: "Reply with exactly: PIGCLAUDE_HOST_OK" })
      await Promise.race([result, new Promise((resolve) => setTimeout(resolve, 90_000))])
      const text = events
        .filter((event) => event.type === "message")
        .flatMap((event) => event.blocks)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
      expect(text).toContain("PIGCLAUDE_HOST_OK")
      expect(usage.records.length).toBeGreaterThan(0)
    } finally {
      unsubscribe()
      await host.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  },
  180_000,
)

it.skipIf(!baseUrl || !authToken)(
  "会话环境的供应商覆盖能直接驱动真实 CLI 回复",
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pigclaude-provider-env-"))
    const userData = await mkdtemp(join(tmpdir(), "pigclaude-provider-env-userdata-"))
    const events: AdapterEvent[] = []
    let resolveDone: (() => void) | null = null
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    const adapter = new ClaudeAgentAdapter({
      ...(binary === undefined ? {} : { resolveBinaryPath: () => binary }),
      onEvent: (event) => {
        events.push(event)
        if (event.type === "result" || event.type === "ended") resolveDone?.()
      },
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    try {
      // daemon 地址给一个不可用端口，确保回复只可能来自供应商覆盖。
      const environment = await SessionEnvironment.create({
        sessionId: "provider-session",
        workspace,
        daemonBaseUrl: "http://127.0.0.1:1",
        sessionToken: "provider-session-token",
        timezone: "UTC",
        locale: "en-US",
        binaryPath: binary ?? resolveClaudeBinaryPath(),
        userDataPath: userData,
        provider: { baseUrl: baseUrl ?? "", authToken: authToken ?? "" },
      })
      expect(environment.env.ANTHROPIC_BASE_URL).toBe(baseUrl)
      expect(environment.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      await adapter.start({
        workspace: environment.workspace,
        env: environment.env,
        permissionMode: "default",
        canUseTool: async () => ({ behavior: "allow" }),
        abortController: controller,
        binaryPath: environment.binaryPath,
        model,
      })
      await adapter.send("Reply with exactly: PIGCLAUDE_PROVIDER_OK")
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 90_000))])
      const text = events
        .filter((event) => event.type === "message")
        .flatMap((event) => event.blocks)
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
      expect(text).toContain("PIGCLAUDE_PROVIDER_OK")
      await environment.cleanup()
    } finally {
      clearTimeout(timer)
      await adapter.stop()
      await rm(workspace, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  },
  180_000,
)

it.skipIf(!baseUrl || !authToken)(
  "自定义供应商下列出模型目录",
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), "pigclaude-provider-models-"))
    try {
      const adapter = new ClaudeAgentAdapter({
        ...(binary === undefined ? {} : { resolveBinaryPath: () => binary }),
      })
      const models = await adapter.models({
        workspace,
        env: providerEnv(join(workspace, "config")),
      })
      expect(models.length).toBeGreaterThan(0)
      // 自定义供应商下 CLI 仍返回内置别名；界面从这份目录里选 default 发起会话。
      expect(models.some((entry) => entry.id === "default")).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  },
  180_000,
)
