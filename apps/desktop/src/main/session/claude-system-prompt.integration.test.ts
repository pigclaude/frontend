// 用同一随包二进制和本机假网关比较桌面会话与原生 CLI 的系统提示结构。

import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect, it, vi } from "vitest"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { startClaudeLocalGateway } from "./claude-local-gateway-fixture"
import { placeholderOAuthToken } from "./session-environment"
import { createHarness } from "./session-host-fixtures"

const run = promisify(execFile)
const binary = bundledBinary()
const model = "sonnet"

it.skipIf(binary === null || process.platform === "win32")(
  "桌面 SDK 和同版本原生 Claude Code 都发送完整的 Claude Code 系统提示",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pigclaude-claude-preset-"))
    const workspace = join(directory, "project")
    const home = join(directory, "home")
    const standaloneConfig = join(directory, "native-config")
    await Promise.all([workspace, home, standaloneConfig].map((path) => mkdir(path)))
    const gateway = await startClaudeLocalGateway()
    const sameEnv = {
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "127.0.0.1,localhost",
      TZ: "America/Los_Angeles",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    }
    const h = createHarness({
      workspace,
      userDataPath: join(directory, "session-data"),
      daemonBaseUrl: gateway.url,
      useRealEnvironment: true,
      resolveBinaryPath: () => binary ?? "",
      createAdapter: (onEvent) =>
        new ClaudeAgentAdapter({
          onEvent,
          queryFn: (params) =>
            query({
              ...params,
              options: { ...params.options, env: { ...params.options.env, ...sameEnv } },
            }),
        }),
    })

    try {
      const { sessionId } = await h.host.start({ workspace, permissionMode: "default", model })
      await h.host.send(sessionId, { text: "pigclaude-preset-comparison" })
      await vi.waitFor(
        () => {
          expect(h.events.some((event) => event.type === "result" && !event.isError)).toBe(true)
        },
        { timeout: 12_000, interval: 60 },
      )
      const sdkBlocks = systemBlocks(
        gateway.messages.find(({ body }) => body.includes("pigclaude-preset-comparison"))?.body,
      )
      await run(
        binary ?? "",
        ["--print", "--setting-sources", "", "--model", model, "vanilla-preset-comparison"],
        {
          cwd: workspace,
          env: {
            ...sameEnv,
            PATH: process.env.PATH,
            CLAUDE_CONFIG_DIR: standaloneConfig,
            ANTHROPIC_BASE_URL: gateway.url,
            CLAUDE_CODE_OAUTH_TOKEN: placeholderOAuthToken,
          },
          timeout: 12_000,
        },
      )
      const cliBlocks = systemBlocks(
        gateway.messages.find(({ body }) => body.includes("vanilla-preset-comparison"))?.body,
      )
      const core = (blocks: string[]): string =>
        blocks.reduce((a, b) => (a.length >= b.length ? a : b), "")
      const sdkCore = core(sdkBlocks)
      const cliCore = core(cliBlocks)
      const sharedInstructionLines = sdkCore
        .split("\n")
        .filter((line) => line.length > 25 && cliCore.includes(line)).length
      expect(sdkCore.length).toBeGreaterThan(1_000)
      expect(cliCore.length).toBeGreaterThan(1_000)
      expect(sharedInstructionLines).toBeGreaterThan(0)
    } finally {
      await h.host.dispose()
      await gateway.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)

function bundledBinary(): string | null {
  try {
    return resolveClaudeBinaryPath({ env: {} })
  } catch {
    return null
  }
}

function systemBlocks(body: string | undefined): string[] {
  if (!body) throw new Error("假网关未收到指定测试消息")
  const parsed: unknown = JSON.parse(body)
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("system" in parsed) ||
    !Array.isArray(parsed.system)
  ) {
    throw new Error("消息缺少系统提示块")
  }
  return parsed.system.flatMap((value: unknown) =>
    value && typeof value === "object" && "text" in value && typeof value.text === "string"
      ? [value.text]
      : [],
  )
}
