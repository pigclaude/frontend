// 用本机合成包核对 Claude Code 插件的允许文件、技能披露与源码复制。

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, expect, it } from "vitest"
import {
  readClaudeCodePluginDirectory,
  synthesizeClaudeCodePlugin,
} from "./claude-code-plugin-bundle"
import { readCapabilityPluginArchive } from "./plugin-archive"
import { pluginArchiveLimits } from "./plugin-archive-entries"

const manifestFile = ".claude-plugin/plugin.json"
const run = promisify(execFile)
const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function files(entries: Record<string, string | Buffer>): ReadonlyMap<string, Buffer> {
  return new Map(Object.entries(entries).map(([name, contents]) => [name, Buffer.from(contents)]))
}

it("由同一份源码原样保留技能和子树资源，排除顶层运行配置并生成最小清单", () => {
  const skill = Buffer.from(
    [
      "\uFEFF---",
      "name: name-in-yaml",
      "description: A local fixture",
      "allowed-tools: Read",
      "hooks: {}",
      "---",
      "Fixture marker !\u0060printf fixture\u0060",
    ].join("\r\n"),
  )
  const source = files({
    [manifestFile]: JSON.stringify({
      name: "review-kit",
      version: "1.1.0",
      description: "本机合成插件",
      hooks: "./config/hooks.json",
      mcpServers: "./config/servers.json",
      lspServers: {},
      userConfig: {},
    }),
    "skills/review/SKILL.md": skill,
    "skills/review/references/example.txt": "合成资源",
    "commands/tools/verify.md": "Verify a local fixture.",
    "agents/reader.md":
      "---\nname: fixture-agent\ndescription: Read the example\n---\nRead the local fixture.",
    "hooks/hooks.json": "{}",
    ".mcp.json": "{}",
    ".lsp.json": "{}",
    "config/hooks.json": "{}",
    "config/servers.json": "{}",
    "README.md": "Pack instructions",
  })
  const bundle = synthesizeClaudeCodePlugin(source, "fallback")
  expect(bundle.manifest).toEqual({
    id: "review-kit",
    name: "review-kit",
    version: "1.1.0",
    description: "本机合成插件",
    commands: ["review-kit:tools:verify"],
    skills: ["review-kit:review"],
    agents: ["review-kit:fixture-agent"],
    ignoredComponents: ["hooks", "mcp", "lsp"],
    skillExecution: [{ name: "review-kit:review", inline: true, hooks: true, allowedTools: true }],
  })
  expect(bundle.files).toEqual(
    files({
      [manifestFile]: JSON.stringify({
        name: "review-kit",
        version: "1.1.0",
        description: "本机合成插件",
      }),
      "skills/review/SKILL.md": skill,
      "skills/review/references/example.txt": "合成资源",
      "commands/tools/verify.md": "Verify a local fixture.",
      "agents/reader.md":
        "---\nname: fixture-agent\ndescription: Read the example\n---\nRead the local fixture.",
    }),
  )
  const cached = synthesizeClaudeCodePlugin(bundle.files, "review-kit")
  expect(cached.files).toEqual(bundle.files)
  expect(cached.manifest).toEqual({ ...bundle.manifest, ignoredComponents: [] })
  expect(cached.executionClaims).toEqual(bundle.executionClaims)
})

it("同名 skill 扩大 YAML allowlist 会增加一条声明指纹，重排和重复不增加声明", () => {
  const key = "skill-allowed-tools:fixture:review"
  const pack = (tools: string) =>
    synthesizeClaudeCodePlugin(
      files({
        "skills/review/SKILL.md": "---\nallowed-tools: " + tools + "\n---\nRead a local fixture.",
      }),
      "fixture",
    )
  const original = pack("[Read, Grep]")
  const reordered = pack("[Grep, Read, Grep]")
  const expanded = pack("[Read, Grep, Glob]")
  expect(original.manifest.skillExecution).toEqual(expanded.manifest.skillExecution)
  expect(reordered.executionClaims).toEqual(original.executionClaims)
  expect(pack("Read, Grep").executionClaims).toEqual(original.executionClaims)
  expect(original.executionClaims[key]).toHaveLength(2)
  expect(expanded.executionClaims[key]).toEqual(
    expect.arrayContaining([...(original.executionClaims[key] ?? [])]),
  )
  expect(expanded.executionClaims[key]).toHaveLength(3)
  expect(expanded.executionClaims[key]?.every((claim) => /^[0-9a-f]{64}$/.test(claim))).toBe(true)
})

it("带括号的标量工具规则保持为一个声明，修改规则会更换指纹", () => {
  const pack = (tool: string) =>
    synthesizeClaudeCodePlugin(
      files({
        "skills/review/SKILL.md":
          "---\nallowed-tools: " + JSON.stringify(tool) + "\n---\nRead the local example.",
      }),
      "fixture",
    )
  const key = "skill-allowed-tools:fixture:review"
  const first = pack("Read(example, one.txt) Grep")
  const changed = pack("Read(example, two.txt) Grep")
  expect(first.executionClaims[key]).toHaveLength(1)
  expect(changed.executionClaims[key]).toHaveLength(1)
  expect(changed.executionClaims[key]).not.toEqual(first.executionClaims[key])
})

it("inline 和文件头 hooks 对合成的执行内容留指纹，普通正文不产生声明", () => {
  const pack = (inline: string, hook: string, summary: string) =>
    synthesizeClaudeCodePlugin(
      files({
        "skills/review/SKILL.md": [
          "---",
          "hooks:",
          "  PreToolUse:",
          "    - hooks:",
          "        - type: command",
          "          command: " + JSON.stringify(hook),
          "---",
          summary,
          "!\u0060" + inline + "\u0060",
        ].join("\n"),
      }),
      "fixture",
    )
  const first = pack("printf one", "printf first", "Fixture description.")
  const changed = pack("printf two", "printf second", "Fixture description.")
  const proseOnly = pack("printf one", "printf first", "Updated fixture description.")
  for (const key of ["skill-inline:fixture:review", "skill-hooks:fixture:review"]) {
    expect(first.executionClaims[key]).toHaveLength(1)
    expect(changed.executionClaims[key]).not.toEqual(first.executionClaims[key])
  }
  expect(proseOnly.executionClaims).toEqual(first.executionClaims)
  expect(
    synthesizeClaudeCodePlugin(
      files({
        "skills/review/SKILL.md": "Read the plain fixture.",
      }),
      "fixture",
    ).executionClaims,
  ).toEqual({})
})

it("按锁定 CLI 的规则保留自定义命令路径、额外技能和显式代理", () => {
  const skill = "---\nname: chosen-skill\ndescription: A local fixture\n---\nFixture."
  const agent = "---\nname: chosen-agent\ndescription: A local fixture\n---\nFixture."
  const bundle = synthesizeClaudeCodePlugin(
    files({
      [manifestFile]: JSON.stringify({
        name: "fixture",
        commands: ["./commands", "./extras/one.md", "./extras/group/"],
        skills: ["./extra-skills", "./single"],
        agents: "./custom-agents/nested/reviewer.md",
        mcpServers: "./single/server.json",
      }),
      "commands/check.md": "Built-in directory command fixture.",
      "extras/one.md": "Direct command fixture.",
      "extras/group/nested/two.md": "Nested command fixture.",
      "skills/normal/SKILL.md": skill,
      "extra-skills/collected/SKILL.md": skill,
      "single/SKILL.md": skill,
      "single/references/example.txt": "Resource fixture.",
      "single/server.json": "{}",
      "agents/ignored.md": agent,
      "custom-agents/nested/reviewer.md": agent,
    }),
    "fallback",
  )
  expect(bundle.manifest).toMatchObject({
    commands: ["fixture:check", "fixture:nested:two", "fixture:one"],
    skills: ["fixture:chosen-skill", "fixture:collected", "fixture:normal"],
    agents: ["fixture:chosen-agent"],
    ignoredComponents: ["mcp"],
  })
  expect(bundle.files).toEqual(
    files({
      [manifestFile]: JSON.stringify({
        name: "fixture",
        version: "0.0.0",
        commands: {
          check: { source: "./commands/check.md" },
          "nested:two": { source: "./commands/nested/two.md" },
          one: { source: "./commands/one.md" },
        },
      }),
      "commands/check.md": "Built-in directory command fixture.",
      "commands/one.md": "Direct command fixture.",
      "commands/nested/two.md": "Nested command fixture.",
      "skills/normal/SKILL.md": skill,
      "skills/collected/SKILL.md": skill,
      "skills/chosen-skill/SKILL.md": skill,
      "skills/chosen-skill/references/example.txt": "Resource fixture.",
      "agents/chosen-agent.md": agent,
    }),
  )
  expect(synthesizeClaudeCodePlugin(bundle.files, "fixture").files).toEqual(bundle.files)
})

it("只输出命名文件命令和内联命令的受支持字段", () => {
  const bundle = synthesizeClaudeCodePlugin(
    files({
      [manifestFile]: JSON.stringify({
        name: "fixture",
        commands: {
          verify: {
            source: "./custom/source-name.md",
            description: "Verify a fixture",
            argumentHint: "[label]",
          },
          inline: {
            content: "Read the fixture.",
            allowedTools: ["Read"],
            hooks: { ignored: true },
          },
        },
      }),
      "custom/source-name.md": "Fixture command.",
      "commands/not-selected.md": "Another fixture.",
    }),
    "unused",
  )
  expect(bundle.files).toEqual(
    files({
      [manifestFile]: JSON.stringify({
        name: "fixture",
        version: "0.0.0",
        commands: {
          inline: { content: "Read the fixture.", allowedTools: ["Read"] },
          verify: {
            source: "./commands/verify.md",
            description: "Verify a fixture",
            argumentHint: "[label]",
          },
        },
      }),
      "commands/verify.md": "Fixture command.",
    }),
  )
  expect(bundle.manifest.commands).toEqual(["fixture:inline", "fixture:verify"])
  expect(bundle.manifest.skillExecution).toEqual([
    { name: "fixture:inline", inline: false, hooks: false, allowedTools: true },
  ])
  expect(bundle.executionClaims["skill-allowed-tools:fixture:inline"]).toEqual([
    expect.stringMatching(/^[0-9a-f]{64}$/),
  ])
  expect(synthesizeClaudeCodePlugin(bundle.files, "fixture").files).toEqual(bundle.files)
})

it("移除命名命令的清单工具字段后重新比较留存的文件头工具声明", () => {
  const pack = (allowedTools?: string[]) =>
    synthesizeClaudeCodePlugin(
      files({
        [manifestFile]: JSON.stringify({
          name: "fixture",
          commands: { read: { source: "./custom/read.md", allowedTools } },
        }),
        "custom/read.md": "---\nallowed-tools: [Read, Grep]\n---\nRead the local fixture.",
      }),
      "unused",
    )
  const key = "skill-allowed-tools:fixture:read"
  const before = pack(["Read"]).executionClaims[key]
  const after = pack().executionClaims[key]
  expect(after).toHaveLength(2)
  expect(after?.filter((fingerprint) => !before?.includes(fingerprint))).toHaveLength(2)
})

it("把无清单的根 skill 与其资源归入标准目录", () => {
  const skill = "---\nname: local-note\ndescription: A local fixture\n---\nFixture."
  const bundle = synthesizeClaudeCodePlugin(
    files({
      "SKILL.md": skill,
      "references/fixtures.txt": "Read-only fixture.",
      "hooks/hooks.json": "{}",
      ".mcp.json": "{}",
      ".lsp.json": "{}",
    }),
    "fallback-id",
  )
  expect(bundle.manifest.skills).toEqual(["fallback-id:local-note"])
  expect(bundle.manifest.ignoredComponents).toEqual(["hooks", "mcp", "lsp"])
  expect(bundle.files).toEqual(
    files({
      [manifestFile]: JSON.stringify({ name: "fallback-id", version: "0.0.0" }),
      "skills/local-note/SKILL.md": skill,
      "skills/local-note/references/fixtures.txt": "Read-only fixture.",
    }),
  )
})

it("真实 git archive 的 GitHub 式包装目录与普通目录合成同一份内容", async () => {
  const root = await temp()
  const source = join(root, "source")
  await mkdir(join(source, "skills", "verify"), { recursive: true })
  await writeFile(join(source, "skills", "verify", "SKILL.md"), "Read the local fixture.")
  await writeFile(join(source, "README.md"), "A fixture repository.")
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, "no-git-config"),
    GIT_CONFIG_NOSYSTEM: "1",
  }
  const git = (...args: string[]) => run("git", args, { cwd: source, env })
  await git("init", "--quiet", "--template=")
  await git("add", ".")
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "Fixture",
  )
  const direct = synthesizeClaudeCodePlugin(await readClaudeCodePluginDirectory(source), "fixture")
  expect(direct.manifest.skills).toEqual(["fixture:verify"])
  for (const extension of ["zip", "tar.gz"]) {
    const archive = join(root, "review-kit-main." + extension)
    await git(
      "archive",
      "--format=" + extension,
      "--prefix=review-kit-main/",
      "--output",
      archive,
      "HEAD",
    )
    const sha256 = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex")
    const files = await readCapabilityPluginArchive(archive, sha256)
    expect(synthesizeClaudeCodePlugin(files, "fixture")).toEqual(direct)
  }
})

it("目录读取遵守与归档一致的单文件和可移植名称限制", async () => {
  const root = await temp()
  const file = join(root, "fixture.txt")
  await writeFile(file, "")
  await truncate(file, pluginArchiveLimits.fileBytes + 1)
  await expect(readClaudeCodePluginDirectory(root)).rejects.toThrow("PLUGIN_BUNDLE_TOO_LARGE")
  await truncate(file, 0)
  // Windows 本身禁止这种名称，文件表校验依然能独立检查它。
  expect(() =>
    synthesizeClaudeCodePlugin(
      files({
        "skills/fixture/SKILL.md": "Fixture.",
        "skills/fixture/CON.txt": "Fixture.",
      }),
      "fallback",
    ),
  ).toThrow("PLUGIN_BUNDLE_UNSAFE")
})

it("本地开发目录不读取 Git 和依赖缓存，仍保留 Claude 清单", async () => {
  const root = await temp()
  for (const directory of [".git", "node_modules"]) {
    const path = join(root, directory)
    await mkdir(path)
    const cache = join(path, "cache.bin")
    await writeFile(cache, "")
    await truncate(cache, pluginArchiveLimits.fileBytes + 1)
  }
  await mkdir(join(root, ".claude-plugin"))
  await writeFile(join(root, manifestFile), '{"name":"fixture"}')
  await mkdir(join(root, "skills", "review"), { recursive: true })
  await writeFile(join(root, "skills", "review", "SKILL.md"), "Read the example.")
  const result = await readClaudeCodePluginDirectory(root)
  expect([...result.keys()].sort()).toEqual([manifestFile, "skills/review/SKILL.md"])
  expect(synthesizeClaudeCodePlugin(result, "fallback").manifest.skills).toEqual(["fixture:review"])
})

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-claude-code-bundle-"))
  temporary.push(root)
  return root
}
