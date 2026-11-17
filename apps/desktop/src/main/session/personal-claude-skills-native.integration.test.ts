// 用随包 Claude Code 和本机假网关验证个人技能的发现、会话复制与原生调用。

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { query, type Options } from "@anthropic-ai/claude-agent-sdk"
import { expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { resolveClaudeBinaryPath } from "./claude-binary"
import { startClaudeLocalGateway } from "./claude-local-gateway-fixture"
import { discoverPersonalClaudeSkills } from "./personal-claude-skills"
import { readCommandCatalog, trackSessionCommandCatalogs } from "./session-command-catalogs"
import { createHarness } from "./session-host-fixtures"

const binary = bundledBinary()

it.skipIf(binary === null)(
  "原生 CLI 展开已启用用户级插件和个人目录里的 skill，并使用隔离设置",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-personal-native-")))
    const home = join(root, "home")
    const workspace = join(root, "project")
    const directory = join(home, ".claude")
    const plugin = join(directory, "plugins", "cache", "matt-fixture")
    await mkdir(workspace)
    await write(
      join(directory, "settings.json"),
      JSON.stringify({
        enabledPlugins: {
          "matt-fixture@official": true,
          "disabled-fixture@official": false,
          "project-fixture@official": true,
        },
        env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:1", OTHER_VALUE: "UNRELATED_SETTINGS_MARKER" },
        skillOverrides: { hidden: "off" },
      }),
    )
    await write(
      join(directory, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "matt-fixture@official": [{ scope: "user", installPath: plugin }],
          "disabled-fixture@official": [{ scope: "user", installPath: join(root, "disabled") }],
          "project-fixture@official": [{ scope: "project", installPath: join(root, "local") }],
        },
      }),
    )
    await write(
      join(plugin, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "matt-fixture",
        skills: ["./skills/engineering/pr"],
        hooks: "./hooks/hooks.json",
      }),
    )
    await write(join(plugin, "hooks", "hooks.json"), "{}")
    await write(join(plugin, ".mcp.json"), '{"mcpServers":{}}')
    await write(
      join(plugin, "skills", "engineering", "pr", "SKILL.md"),
      "---\nname: pr\ndescription: Draft the PR\n---\nPERSONAL_PLUGIN_INSTRUCTIONS",
    )
    await write(join(plugin, "skills", "engineering", "pr", "guide.md"), "PR_GUIDE")
    const linkedSkill = join(root, "shared-skills", "baseline")
    await write(
      join(linkedSkill, "SKILL.md"),
      "---\nname: baseline\ndescription: Check the baseline\n---\nPERSONAL_BARE_INSTRUCTIONS",
    )
    await write(join(directory, "skills", "hidden", "SKILL.md"), "---\nname: hidden\n---\nHIDDEN")
    await symlink(linkedSkill, join(directory, "skills", "baseline"), "junction")
    for (const name of ["disabled", "local"]) {
      await write(join(root, name, ".claude-plugin", "plugin.json"), JSON.stringify({ name }))
      await write(join(root, name, "skills", "skip", "SKILL.md"), "Do not list this.")
    }

    const gateway = await startClaudeLocalGateway()
    const source = {
      stage: async () => [],
      commands: async () => [],
      personalSkills: () => discoverPersonalClaudeSkills({ directory }),
    }
    let options: Options | undefined
    const h = createHarness({
      workspace,
      userDataPath: join(root, "data"),
      daemonBaseUrl: gateway.url,
      useRealEnvironment: true,
      resolveBinaryPath: () => binary ?? "",
      claudeCodePlugins: source,
      createAdapter: (onEvent) =>
        new ClaudeAgentAdapter({
          onEvent,
          queryFn: ({ prompt, options: sdk }) => {
            options = sdk
            return query({
              prompt,
              options: {
                ...sdk,
                env: {
                  ...sdk.env,
                  HOME: home,
                  USERPROFILE: home,
                  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                  HTTP_PROXY: "http://127.0.0.1:1",
                  HTTPS_PROXY: "http://127.0.0.1:1",
                  NO_PROXY: "127.0.0.1,localhost",
                  ...(process.platform === "win32"
                    ? {
                        SystemRoot: process.env.SystemRoot,
                        ComSpec: process.env.ComSpec,
                        PATHEXT: process.env.PATHEXT,
                      }
                    : { SHELL: "/bin/bash" }),
                },
              },
            })
          },
        }),
    })
    trackSessionCommandCatalogs(h.host, source)
    try {
      const selected = (await readCommandCatalog(h.host, workspace)).filter(
        ({ scope }) => scope === "user",
      )
      expect(selected.map(({ text }) => text)).toEqual(["$baseline", "$matt-fixture:pr"])
      const { sessionId } = await h.host.start({
        workspace,
        permissionMode: "default",
        model: "sonnet",
      })
      if (!options) throw new Error("未启动 Claude CLI")
      const privatePlugin = options.plugins?.[0]?.path
      if (!privatePlugin) throw new Error("插件技能未复制到会话")
      await expect(readFile(join(privatePlugin, "skills", "pr", "guide.md"), "utf8")).resolves.toBe(
        "PR_GUIDE",
      )
      await expect(access(join(privatePlugin, "hooks", "hooks.json"))).rejects.toMatchObject({
        code: "ENOENT",
      })
      await expect(access(join(privatePlugin, ".mcp.json"))).rejects.toMatchObject({
        code: "ENOENT",
      })
      expect(options.env?.["CLAUDE_CONFIG_DIR"]).not.toBe(directory)

      for (const [name, marker] of [
        ["matt-fixture:pr", "PERSONAL_PLUGIN_INSTRUCTIONS"],
        ["baseline", "PERSONAL_BARE_INSTRUCTIONS"],
      ] as const) {
        const results = h.events.filter(({ type }) => type === "result").length
        await h.host.send(sessionId, { text: "Run $" + name + " for this example." })
        await vi.waitFor(
          () => expect(h.events.filter(({ type }) => type === "result")).toHaveLength(results + 1),
          { timeout: 12_000 },
        )
        expect(
          gateway.messages.some(({ body }) => body.includes(marker)),
          name,
        ).toBe(true)
      }
      const active = (await readCommandCatalog(h.host, workspace, sessionId)).filter(
        ({ scope }) => scope === "user",
      )
      expect(active.map(({ text }) => text)).toEqual(["$baseline", "$matt-fixture:pr"])
    } finally {
      await h.host.dispose()
      await gateway.close()
      await rm(root, { recursive: true, force: true })
    }
  },
  30_000,
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
