// 用随包 CLI 验证完全信任后项目 hook 和 MCP 生效，实际消息仍使用 PigClaude 的合成转发凭据。

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { expect, it, vi } from "vitest"
import { ProjectTrustStore, projectTrustFilePath } from "../runtime/project-trust-store"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { startClaudeLocalGateway } from "./claude-local-gateway-fixture"
import { createHarness } from "./session-host-fixtures"

const binary = bundledBinary()

it.skipIf(binary === null || process.platform === "win32")(
  "运行可信项目的 hook 和 MCP，忽略替代地址、代理与认证设置",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-trusted-native-")))
    const home = join(root, "home")
    const workspace = join(root, "project")
    const data = join(root, "data")
    const projectConfig = join(workspace, ".claude")
    await mkdir(home)
    await mkdir(projectConfig, { recursive: true })
    const gateway = await startClaudeLocalGateway()
    const marker = join(root, "hook.json")
    const blockedHelper = join(root, "helper-started")
    const mcpMarker = join(root, "mcp-started")
    const hook = join(root, "hook.cjs")
    const helper = join(root, "helper.cjs")
    const mcp = join(root, "mcp.cjs")
    await writeFile(
      hook,
      `
      const { writeFileSync } = require("node:fs");
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
        cwd: process.cwd(),
        label: process.env.PIGCLAUDE_SYNTHETIC_LABEL,
        locale: process.env.TZ,
        proxy: process.env.HTTPS_PROXY ?? "",
      }));
    `,
    )
    await writeFile(
      helper,
      `require("node:fs").writeFileSync(${JSON.stringify(blockedHelper)}, "unexpected");`,
    )
    await writeFile(mcp, mockMcp(mcpMarker))
    await writeFile(
      join(projectConfig, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
          ANTHROPIC_API_KEY: "synthetic-project-key",
          ANTHROPIC_AUTH_TOKEN: "synthetic-project-authorization",
          ANTHROPIC_CUSTOM_HEADERS: "x-synthetic: project",
          HTTPS_PROXY: "http://127.0.0.1:1",
          TZ: "Asia/Tokyo",
          PIGCLAUDE_SYNTHETIC_LABEL: "shared setting",
        },
        apiKeyHelper: shellCommand(helper),
        enableAllProjectMcpServers: true,
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: shellCommand(hook) }] }] },
      }),
    )
    await writeFile(
      join(projectConfig, "settings.local.json"),
      JSON.stringify({
        env: { PIGCLAUDE_SYNTHETIC_LABEL: "local setting" },
      }),
    )
    await writeFile(
      join(workspace, ".mcp.json"),
      JSON.stringify({
        mcpServers: { synthetic: { command: process.execPath, args: [mcp] } },
      }),
    )
    await new ProjectTrustStore(projectTrustFilePath(data)).setTrusted(workspace, true)
    const h = createHarness({
      workspace,
      userDataPath: data,
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
                env: {
                  ...options.env,
                  HOME: home,
                  USERPROFILE: home,
                  SHELL: "/bin/bash",
                  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                },
              },
            }),
        }),
    })
    try {
      const { sessionId } = await h.host.start({
        workspace,
        permissionMode: "default",
        model: "sonnet",
      })
      await h.host.send(sessionId, { text: "trusted-project-synthetic-turn" })
      await vi.waitFor(
        () => {
          const modelRequest = gateway.messages.find(({ body }) =>
            body.includes("trusted-project-synthetic-turn"),
          )
          expect(modelRequest).toMatchObject({
            hasSessionHeader: true,
            hasPlaceholderCredential: true,
          })
        },
        { timeout: 15_000 },
      )
      expect(JSON.parse(await readFile(marker, "utf8"))).toEqual({
        cwd: workspace,
        label: "local setting",
        locale: "America/Los_Angeles",
        proxy: "",
      })
      await expect(readFile(mcpMarker, "utf8")).resolves.toBe("started")
      await expect(stat(blockedHelper)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await h.host.dispose()
      await gateway.close()
      await rm(root, { recursive: true, force: true })
    }
  },
  25_000,
)

function bundledBinary(): string | null {
  try {
    return resolveClaudeBinaryPath({ env: {} })
  } catch {
    return null
  }
}

function shellCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`
}

function mockMcp(marker: string): string {
  return `
    const { writeFileSync } = require("node:fs");
    const { createInterface } = require("node:readline");
    writeFileSync(${JSON.stringify(marker)}, "started");
    createInterface({ input: process.stdin }).on("line", (line) => {
      const input = JSON.parse(line);
      if (input.id === undefined) return;
      const result = input.method === "initialize"
        ? { protocolVersion: input.params.protocolVersion, capabilities: { tools: {} },
            serverInfo: { name: "synthetic", version: "0.0.1" } }
        : { tools: [] };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }) + "\\n");
    });
  `
}
