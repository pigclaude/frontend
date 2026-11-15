// 通过真实会话环境和假 SDK 检验项目指令、命令和 skill 的来源范围，且不加载未信任的项目设置。

import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { capture, FakeQuery, type CapturedQuery } from "./claude-agent-adapter-fixtures"
import { prepareProjectConfiguration } from "./project-configuration"
import { createHarness } from "./session-host-fixtures"
import { normalizeSdkMessage } from "./claude-sdk-messages"

it("加载工作目录与 Git 根之间的项目扩展，保持原工作目录并隔离项目设置", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-project-sources-")))
  const repo = join(directory, "repo")
  const workspace = join(repo, "packages", "app")
  await mkdir(workspace, { recursive: true })
  await mkdir(join(repo, ".git"))
  await projectFile(repo, "CLAUDE.md", "repo guidance")
  await projectFile(repo, ".claude/commands/build.md", "parent command")
  await projectFile(workspace, ".claude/commands/build.md", "local command")
  await projectFile(repo, ".claude/commands/test.md", "other command")
  await projectFile(repo, ".claude/commands/checks/parent.md", "parent nested command")
  await projectFile(workspace, ".claude/commands/checks/current.md", "current nested command")
  await projectFile(repo, ".claude/output-styles/compact.md", "project style")
  await projectFile(repo, ".claude/skills/release/SKILL.md", "release guide")
  await projectFile(workspace, ".claude/agents/linter.md", "workspace agent")
  await projectFile(join(repo, "other"), ".claude/skills/unrelated/SKILL.md", "unrelated")
  await projectFile(repo, ".claude/settings.json", '{"env":{"UNTRUSTED_SYNTHETIC":"on"}}')
  await projectFile(workspace, ".claude/settings.local.json", "{}")
  await projectFile(workspace, ".mcp.json", '{"mcpServers":{}}')
  const captured: CapturedQuery[] = []
  const home = createHarness({
    workspace,
    userDataPath: join(directory, "data"),
    useRealEnvironment: true,
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({ onEvent, queryFn: capture(new FakeQuery(), captured) }),
  })

  try {
    const { sessionId } = await home.host.start({ workspace, permissionMode: "default" })
    const options = captured[0]?.options
    expect(options).toMatchObject({
      cwd: workspace,
      settingSources: ["project"],
      strictMcpConfig: true,
      env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" },
      settings: {
        claudeMdExcludes: expect.arrayContaining([
          join(directory, "CLAUDE.md").replaceAll("\\", "/"),
          join(directory, "AGENTS.md").replaceAll("\\", "/"),
        ]),
        autoMemoryEnabled: false,
        disableClaudeAiConnectors: true,
      },
    })
    const root = options?.projectConfigRoot
    if (root === undefined) throw new Error("未生成项目配置根")
    for (const [name, expected] of [
      ["parent", "parent nested command"],
      ["current", "current nested command"],
    ]) {
      expect(
        await readFile(join(root, ".claude", "commands", "checks", `${name}.md`), "utf8"),
      ).toBe(expected)
    }
    expect(await readFile(join(root, ".claude", "output-styles", "compact.md"), "utf8")).toBe(
      "project style",
    )
    expect(root).not.toBe(workspace)
    expect(await readFile(join(root, ".claude", "commands", "build.md"), "utf8")).toBe(
      "local command",
    )
    expect(await readFile(join(root, ".claude", "commands", "test.md"), "utf8")).toBe(
      "other command",
    )
    expect(await readFile(join(root, ".claude", "skills", "release", "SKILL.md"), "utf8")).toBe(
      "release guide",
    )
    expect(await readFile(join(root, ".claude", "agents", "linter.md"), "utf8")).toBe(
      "workspace agent",
    )
    for (const relative of [
      ".claude/settings.json",
      ".claude/settings.local.json",
      ".mcp.json",
      ".claude/skills/unrelated",
    ]) {
      await expect(stat(join(root, relative))).rejects.toMatchObject({ code: "ENOENT" })
    }
    await home.host.stop(sessionId)
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await home.host.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

it("跳过个人配置目录和指向项目之外的嵌套链接", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-project-link-scope-"))
  const workspace = join(directory, "workspace")
  const scratch = join(directory, "scratch")
  const home = join(directory, "home")
  const personalSkills = join(home, ".claude", "skills")
  try {
    await mkdir(scratch)
    await projectFile(personalSkills, "personal/SKILL.md", "private skill")
    await projectFile(workspace, ".claude/skills/working/SKILL.md", "workspace skill")
    await projectFile(workspace, ".claude/skills/linked/SKILL.md", "unsafe alias")
    await symlink(
      personalSkills,
      join(workspace, ".claude", "skills", "linked", "outside"),
      process.platform === "win32" ? "junction" : "dir",
    )
    for (const path of [home, personalSkills]) {
      await expect(prepareProjectConfiguration(path, scratch, home)).resolves.toMatchObject({
        directory: null,
      })
    }
    const configuration = await prepareProjectConfiguration(workspace, scratch, home)
    if (configuration.directory === null) throw new Error("合法项目应存在配置根")
    const skills = join(configuration.directory, ".claude", "skills")
    await expect(readFile(join(skills, "working", "SKILL.md"), "utf8")).resolves.toBe(
      "workspace skill",
    )
    await expect(stat(join(skills, "linked", "outside"))).rejects.toMatchObject({ code: "ENOENT" })
    const working = join(workspace, ".claude", "skills", "working")
    await writeFile(join(working, "SKILL.md"), "updated workspace skill")
    await symlink(
      personalSkills,
      join(working, "new-alias"),
      process.platform === "win32" ? "junction" : "dir",
    )
    try {
      await vi.waitFor(
        async () => {
          await expect(readFile(join(skills, "working", "SKILL.md"), "utf8")).resolves.toBe(
            "updated workspace skill",
          )
        },
        { timeout: 4_000 },
      )
      await expect(stat(join(skills, "working", "new-alias"))).rejects.toMatchObject({
        code: "ENOENT",
      })
    } finally {
      await configuration.dispose()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it("把 CLI 拒绝 skill 内联命令的空回合转成可见提示", () => {
  const events = normalizeSdkMessage({
    type: "user",
    session_id: "test-session",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content:
        "<local-command-stderr>Shell command permission check failed: This command requires approval</local-command-stderr>",
    },
  })
  expect(events).toEqual([
    { type: "error", code: "SDK_ERROR", message: expect.stringContaining("内联命令未获许可") },
  ])
})

async function projectFile(directory: string, relative: string, text: string): Promise<void> {
  const components = relative.split("/")
  const name = components.pop() ?? ""
  const parent = join(directory, ...components)
  await mkdir(parent, { recursive: true })
  await writeFile(join(parent, name), text)
}
