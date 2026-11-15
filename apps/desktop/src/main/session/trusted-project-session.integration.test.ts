// 从会话入口核对真实项目的信任快照，以及 SDK 收到的账号转发和环境固定项。

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { ProjectTrustStore, projectTrustFilePath } from "../runtime/project-trust-store"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { capture, FakeQuery, type CapturedQuery } from "./claude-agent-adapter-fixtures"
import { placeholderOAuthToken } from "./session-environment"
import { createHarness } from "./session-host-fixtures"

it("可信项目使用原生设置来源，撤销后新启动恢复隔离，当前会话的固定项保持有效", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-trusted-launch-")))
  const workspace = join(root, "project")
  const userDataPath = join(root, "data")
  const trust = new ProjectTrustStore(projectTrustFilePath(userDataPath))
  const captured: CapturedQuery[] = []
  const h = createHarness({
    workspace,
    userDataPath,
    useRealEnvironment: true,
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({ onEvent, queryFn: capture(new FakeQuery(), captured) }),
  })
  try {
    await mkdir(join(workspace, ".claude"), { recursive: true })
    await writeFile(
      join(workspace, ".claude", "settings.local.json"),
      JSON.stringify({
        env: { AntHropic_Base_Url: "http://127.0.0.1:1", USER_PROJECT_TAG: "synthetic" },
      }),
    )
    await trust.setTrusted(workspace, true)
    await h.host.start({ workspace, permissionMode: "default" })
    const trusted = captured[0]?.options
    expect(trusted).toMatchObject({
      cwd: workspace,
      projectConfigRoot: workspace,
      strictMcpConfig: false,
      settingSources: ["project", "local"],
      settings: {
        apiKeyHelper: "",
        env: {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:47821",
          AntHropic_Base_Url: "http://127.0.0.1:47821",
          ANTHROPIC_CUSTOM_HEADERS: `x-pigclaude-session: ${h.runtime.sessionToken}`,
          CLAUDE_CODE_OAUTH_TOKEN: placeholderOAuthToken,
          ANTHROPIC_API_KEY: "",
          ANTHROPIC_AUTH_TOKEN: "",
          CLAUDE_CODE_USE_BEDROCK: "0",
          CLAUDE_CODE_USE_VERTEX: "0",
          CLAUDE_CODE_USE_FOUNDRY: "0",
          HTTPS_PROXY: "",
          TZ: "America/Los_Angeles",
        },
      },
    })
    expect(trusted?.settings).not.toHaveProperty("env.USER_PROJECT_TAG")
    await trust.setTrusted(workspace, false)
    await h.host.start({ workspace, permissionMode: "default" })
    expect(captured[1]?.options).toMatchObject({
      settingSources: ["project"],
      strictMcpConfig: true,
    })
    expect(captured[1]?.options.projectConfigRoot).not.toBe(workspace)
    expect(trusted?.settingSources).toEqual(["project", "local"])
  } finally {
    await h.host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
