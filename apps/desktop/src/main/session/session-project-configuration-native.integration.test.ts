// 用随包 Claude Code 和本机假网关验证项目指令与 skill 的生效范围，且始终使用合成会话。

import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { startClaudeLocalGateway } from "./claude-local-gateway-fixture"
import { createHarness } from "./session-host-fixtures"

const binary = bundledBinary()

it.skipIf(binary === null)(
  "随包 CLI 展开项目 skill 和项目内引用，跳过仓库外指令和项目设置",
  async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-real-project-")))
    const fauxHome = join(directory, "home")
    const repo = join(fauxHome, "repo")
    const workspace = join(repo, "pkg")
    const temp = join(directory, "tmp")
    const testInlineCommand = process.platform !== "win32"
    await mkdir(workspace, { recursive: true })
    await mkdir(temp)
    await promisify(execFile)("git", ["init", "-q"], { cwd: repo })
    await write(join(workspace, "CLAUDE.md"), "WORKSPACE_INSTRUCTIONS\n@./guidance.md\n")
    await write(join(workspace, "guidance.md"), "WORKSPACE_IMPORTED_INSTRUCTIONS")
    await write(join(repo, "CLAUDE.md"), "REPOSITORY_INSTRUCTIONS")
    await write(join(directory, "CLAUDE.md"), "OUTSIDE_INSTRUCTIONS")
    await write(join(fauxHome, "CLAUDE.md"), "HOME_ANCESTOR_INSTRUCTIONS")
    await write(join(fauxHome, ".claude", "CLAUDE.md"), "PERSONAL_INSTRUCTIONS")
    await write(
      join(repo, ".claude", "skills", "verify-project", "SKILL.md"),
      "---\nname: verify-project\ndescription: Synthetic project configuration probe.\nallowed-tools: Bash(printf *)\n---\n\nPROJECT_SKILL_INSTRUCTIONS\n" +
        (testInlineCommand ? "!\u0060printf PROJECT_SKILL_COMMAND\u0060\n" : ""),
    )
    const gateway = await startClaudeLocalGateway()
    const mcpMarker = join(directory, "mcp-started")
    await write(
      join(workspace, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          synthetic: {
            command: process.execPath,
            args: [
              "-e",
              `require("node:fs").writeFileSync(${JSON.stringify(mcpMarker)}, "started")`,
            ],
          },
        },
      }),
    )
    await write(
      join(workspace, ".claude", "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1" } }),
    )
    const h = createHarness({
      workspace,
      userDataPath: join(directory, "data"),
      daemonBaseUrl: gateway.url,
      useRealEnvironment: true,
      resolveBinaryPath: () => binary ?? "",
      createAdapter: (onEvent) =>
        new ClaudeAgentAdapter({
          onEvent,
          queryFn: ({ prompt, options }) =>
            query({
              prompt,
              options: {
                ...options,
                stderr: (chunk) => {
                  cliStderr = (cliStderr + chunk).slice(-800)
                },
                env: {
                  ...options.env,
                  HOME: fauxHome,
                  USERPROFILE: fauxHome,
                  USER: "pigclaude-test",
                  LOGNAME: "pigclaude-test",
                  TEMP: temp,
                  TMP: temp,
                  TMPDIR: temp,
                  ...(process.platform === "win32"
                    ? {
                        SystemRoot: process.env.SystemRoot,
                        ComSpec: process.env.ComSpec,
                        PATHEXT: process.env.PATHEXT,
                      }
                    : { SHELL: "/bin/bash" }),
                  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                  HTTP_PROXY: "http://127.0.0.1:1",
                  HTTPS_PROXY: "http://127.0.0.1:1",
                  NO_PROXY: "127.0.0.1,localhost",
                },
              },
            }),
        }),
    })
    let cliStderr = ""
    try {
      const { sessionId } = await h.host.start({
        workspace,
        permissionMode: "default",
        model: "sonnet",
      })
      await h.host.send(sessionId, { text: "/verify-project" })
      await vi
        .waitFor(
          () => {
            expect(h.events.some((event) => event.type === "result" && !event.isError)).toBe(true)
          },
          { timeout: 18_000, interval: 50 },
        )
        .catch(() => {
          const errors = h.events.flatMap((event) =>
            event.type === "error" ? [event.message] : [],
          )
          throw new Error(
            `随包 CLI 未完成。消息数: ${gateway.messages.length}。${errors.join(" ")} ${cliStderr}`,
          )
        })
      const messages = gateway.messages.map((item) => item.body).join("\n")
      expect(messages).toContain("REPOSITORY_INSTRUCTIONS")
      expect(messages).toContain("WORKSPACE_IMPORTED_INSTRUCTIONS")
      expect(messages).toContain("PROJECT_SKILL_INSTRUCTIONS")
      if (testInlineCommand) expect(messages).toContain("PROJECT_SKILL_COMMAND")
      expect(messages).not.toMatch(
        /OUTSIDE_INSTRUCTIONS|PERSONAL_INSTRUCTIONS|HOME_ANCESTOR_INSTRUCTIONS/,
      )
      await expect(stat(mcpMarker)).rejects.toMatchObject({ code: "ENOENT" })
      expect(gateway.messages.some((item) => item.hasSessionHeader)).toBe(true)
    } finally {
      await h.host.dispose()
      await gateway.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
  25_000,
)

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

function bundledBinary(): string | null {
  try {
    return resolveClaudeBinaryPath({ env: {} })
  } catch {
    return null
  }
}
