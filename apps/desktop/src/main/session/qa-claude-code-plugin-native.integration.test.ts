// 通过随包 CLI 与本机假网关验证已安装 Claude Code 插件的命令、技能和启动隔离。
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { query } from "@anthropic-ai/claude-agent-sdk"
import { expect, it, vi } from "vitest"
import { CapabilityPluginManager } from "../plugins/capability-plugin-manager"
import { readCapabilityPluginArchive } from "../plugins/plugin-archive"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { startClaudeLocalGateway } from "./claude-local-gateway-fixture"
import { createHarness } from "./session-host-fixtures"

it("已安装插件的命令和技能可用，插件级 hooks 与 MCP 未启动", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-installed-plugin-qa-"))
  const plugin = join(root, "fixture-acceptance")
  const project = join(root, "workspace")
  const home = join(root, "isolated-home")
  const hookMarker = join(root, "unexpected-hook")
  const mcpMarker = join(root, "unexpected-mcp")
  const markerScript = join(root, "mark.cjs")
  const gateway = await startClaudeLocalGateway()
  const write = async (path: string, contents: string) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  const manager = new CapabilityPluginManager({
    root: join(root, "manager"),
    appVersion: "0.0.1",
    membership: () => "active",
    developerMode: () => true,
    readArchive: readCapabilityPluginArchive,
    stopInstances: () => undefined,
  })
  const h = createHarness({
    workspace: project,
    userDataPath: join(root, "data"),
    daemonBaseUrl: gateway.url,
    useRealEnvironment: true,
    resolveBinaryPath: () => resolveClaudeBinaryPath({ env: {} }),
    claudeCodePlugins: {
      stage: manager.stageClaudeCodePlugins.bind(manager),
      commands: manager.claudeCodePluginCommands.bind(manager),
    },
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ prompt, options: options }) =>
          query({
            prompt,
            options: {
              ...options,
              env: {
                ...options.env,
                HOME: home,
                USERPROFILE: home,
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
  try {
    await mkdir(project)
    await mkdir(home)
    await write(markerScript, 'require("node:fs").writeFileSync(process.argv[2], "ran")')
    await write(
      join(plugin, ".claude-plugin/plugin.json"),
      JSON.stringify({ name: "fixture-acceptance", version: "1.0.0" }),
    )
    await write(
      join(plugin, "commands/overview.md"),
      "Return the synthesized command marker COMMAND_OVERVIEW_MARKER.",
    )
    await write(
      join(plugin, "skills/lookup/SKILL.md"),
      "---\nname: lookup\ndescription: Read the local synthesized plugin marker.\n---\nReturn SKILL_LOOKUP_MARKER.",
    )
    await write(
      join(plugin, "hooks/hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: [process.execPath, markerScript, hookMarker]
                    .map((value) => JSON.stringify(value))
                    .join(" "),
                },
              ],
            },
          ],
        },
      }),
    )
    await write(
      join(plugin, ".mcp.json"),
      JSON.stringify({
        mcpServers: { "local-qa": { command: process.execPath, args: [markerScript, mcpMarker] } },
      }),
    )
    const owner = {}
    const disclosure = await manager.prepare({ kind: "directory", path: plugin }, owner)
    expect(disclosure.type).toBe("claude-code")
    await manager.confirm(disclosure.confirmationId, owner)
    expect(await manager.claudeCodePluginCommands()).toEqual([
      "fixture-acceptance:lookup",
      "fixture-acceptance:overview",
    ])
    const { sessionId } = await h.host.start({
      workspace: project,
      permissionMode: "default",
      model: "sonnet",
    })
    for (const [prompt, marker] of [
      ["/fixture-acceptance:overview", "COMMAND_OVERVIEW_MARKER"],
      ["/fixture-acceptance:lookup", "SKILL_LOOKUP_MARKER"],
    ]) {
      const before = h.events.filter(({ type }) => type === "result").length
      await h.host.send(sessionId, { text: prompt })
      await vi.waitFor(
        () => {
          expect(h.events.filter(({ type }) => type === "result")).toHaveLength(before + 1)
        },
        { timeout: 12_000 },
      )
      expect(
        gateway.messages.some(({ body }) => body.includes(marker)),
        marker,
      ).toBe(true)
    }
    await expect(access(hookMarker)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(access(mcpMarker)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await h.host.dispose()
    await gateway.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
