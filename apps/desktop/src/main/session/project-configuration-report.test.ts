// 验证报告只披露项目可执行配置和环境变量名，并标明命令冲突与不可读取的文件。
import { expect, it } from "vitest"
import { describeProjectConfiguration } from "./project-configuration-report"

it("披露可执行项而不传递环境变量值、MCP 参数或请求头", () => {
  const report = describeProjectConfiguration({
    workspace: "/p",
    trust: "untrusted",
    instructions: ["CLAUDE.md"],
    commands: [
      { name: "new", kind: "command", file: "/p/.claude/commands/new.md" },
      { name: "checks:lint", kind: "command", file: "/p/.claude/commands/checks/lint.md" },
      { name: "release", kind: "skill", file: "/p/.claude/skills/release/SKILL.md" },
    ],
    agentCount: 2,
    settings: [
      {
        path: ".claude/settings.json",
        text: `{
        // 项目设置可以带注释
        env: { ACCESS_TOKEN: 'test-env-secret' },
        apiKeyHelper: 'resolve-key test-env-secret',
        hooks: { SessionStart: [{hooks: [{type: 'command', command: 'echo test-env-secret'}]}] },
      }`,
      },
    ],
    mcp: [
      {
        path: ".mcp.json",
        text: JSON.stringify({
          mcpServers: {
            local: {
              command: "node",
              args: ["invoke", "test-arg-secret"],
              env: { MCP_TOKEN: "test-mcp-secret" },
            },
            remote: {
              type: "http",
              url: "https://sample.invalid",
              headers: { Authorization: "test-header-secret" },
            },
          },
        }),
      },
    ],
    skills: [
      {
        name: "release",
        path: ".claude/skills/release/SKILL.md",
        text: "---\nname: release\n'allowed-tools': Bash\nhooks: {}\n---\n!\u0060echo inline\u0060\n",
      },
    ],
  })

  expect(report).toMatchObject({
    instructions: ["CLAUDE.md"],
    counts: { commands: 2, skills: 1, agents: 2 },
    environment: ["ACCESS_TOKEN", "MCP_TOKEN"],
    hooks: [{ event: "SessionStart", kind: "command", command: "echo [已隐藏]" }],
    servers: [
      { name: "local", command: "node" },
      { name: "remote", command: null },
    ],
    credentialScripts: [{ name: "apiKeyHelper", command: "resolve-key [已隐藏]" }],
    skillExecution: [{ name: "release", inline: true, hooks: true, allowedTools: true }],
    shadowedCommands: ["new"],
    unreadable: [],
  })
  expect(JSON.stringify(report)).not.toMatch(/test-(env|mcp|arg|header)-secret/)
})

it("标出不能读或解析的配置文件", () => {
  const report = describeProjectConfiguration({
    workspace: "/p",
    trust: "untrusted",
    instructions: [],
    commands: [],
    agentCount: 0,
    settings: [{ path: ".claude/settings.json", text: "{invalid" }],
    mcp: [{ path: ".mcp.json", text: null }],
    skills: [],
  })
  expect(report.unreadable).toEqual([".claude/settings.json", ".mcp.json"])
})
