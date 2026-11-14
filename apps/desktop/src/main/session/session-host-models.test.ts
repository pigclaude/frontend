// 负责验证 SessionHost 的模型目录查询：先经 daemon 读组织模型，再在一次性环境里让 Claude Code 列出模型；
// 读不到组织模型或 Claude Code 列不出时回退到内置目录并提示，环境都会清理。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CLAUDE_FALLBACK_MODELS } from "./claude-model-catalog"
import { createHarness, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []
const organizationModels = [
  { value: "claude-org-alpha", label: "Org Alpha", description: "Alpha model" },
]

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost models", () => {
  it("queries models in a temporary environment even with an active session", async () => {
    const harness = await startedHarness()

    const catalog = await harness.host.models()

    expect(catalog).toEqual({ models: harness.adapters.last.modelsResult, cliError: null })
    expect(harness.environments.inputs).toHaveLength(2)
    expect(harness.adapters.last.modelCalls[0]).toEqual({
      workspace: harness.workspace,
      env: harness.environments.last.env,
      binaryPath: "/fake/claude",
      timeoutMs: 15_000,
    })
    expect(harness.environments.last.cleaned).toBe(1)
    await harness.host.dispose()
  })

  it("gives Claude Code only what a slow organization read left of the query budget", async () => {
    const harness = createHarness({ workspace: await workspaceDir(), bootstrapDelayMs: 4_000 })

    await harness.host.models()

    expect(harness.adapters.last.modelCalls[0]?.timeoutMs).toBe(11_000)
    await harness.host.dispose()
  })

  it("reads the organization models through the daemon and hands them to the catalog query", async () => {
    const harness = createHarness({ workspace: await workspaceDir(), organizationModels })

    await harness.host.models()

    expect(harness.bootstrapReads).toEqual([
      { baseUrl: "http://127.0.0.1:47821", sessionToken: "runtime-session-token" },
    ])
    expect(harness.environments.inputs[0]?.modelCatalog).toEqual({ organizationModels })
    expect(harness.events.filter((event) => event.type === "notice")).toEqual([])
    await harness.host.dispose()
  })

  it("still lists the Claude Code catalog and tells the user when the organization models are unavailable", async () => {
    const harness = createHarness({ workspace: await workspaceDir(), organizationModels: null })

    const catalog = await harness.host.models()

    expect(harness.environments.inputs[0]?.modelCatalog).toEqual({ organizationModels: null })
    expect(catalog).toEqual({ models: harness.adapters.last.modelsResult, cliError: null })
    expect(harness.events).toContainEqual({
      type: "notice",
      message: "暂时读不到 Claude 账号所在组织的模型，只显示内置模型。",
    })
    await harness.host.dispose()
  })

  it("falls back to the built-in catalog and tells the user when Claude Code cannot list models", async () => {
    const harness = createHarness({
      workspace: await workspaceDir(),
      modelsError: new Error("MODEL_QUERY_TIMEOUT: 超时 runtime-session-token"),
    })

    const catalog = await harness.host.models()

    expect(catalog).toEqual({
      models: [...CLAUDE_FALLBACK_MODELS],
      cliError: "SDK_ERROR: MODEL_QUERY_TIMEOUT: 超时 [redacted]",
    })
    expect(harness.events).toContainEqual({
      type: "notice",
      message: "暂时读不到 Claude Code 的模型列表，先显示内置模型。",
    })
    expect(harness.environments.last.cleaned).toBe(1)
    await harness.host.dispose()
  })

  it("falls back without asking the daemon when it is not ready", async () => {
    const harness = createHarness({ workspace: await workspaceDir(), daemonBaseUrl: null })

    const catalog = await harness.host.models()

    expect(catalog).toEqual({
      models: [...CLAUDE_FALLBACK_MODELS],
      cliError: "DAEMON_UNAVAILABLE: 本机 daemon 尚未就绪",
    })
    expect(harness.bootstrapReads).toEqual([])
    expect(harness.environments.inputs).toEqual([])
    expect(harness.events.filter((event) => event.type === "notice")).toHaveLength(1)
    await harness.host.dispose()
  })

  it("keeps rejecting without a valid membership", async () => {
    const harness = createHarness({ workspace: await workspaceDir(), membershipState: "expired" })

    await expect(harness.host.models()).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" })
    expect(harness.bootstrapReads).toEqual([])
    expect(harness.environments.inputs).toEqual([])
    await harness.host.dispose()
  })

  it("uses a temporary isolated environment when no session is active", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })

    await harness.host.models()

    expect(harness.environments.inputs).toHaveLength(1)
    expect(harness.environments.inputs[0]).toMatchObject({
      workspace: harness.workspace,
      binaryPath: "/fake/claude",
    })
    expect(harness.adapters.last.modelCalls[0]?.workspace).toBe(harness.workspace)
    expect(harness.environments.last.cleaned).toBe(1)
    await harness.host.dispose()
  })
})

async function startedHarness(): Promise<SessionHarness> {
  const harness = createHarness({ workspace: await workspaceDir() })
  await harness.host.start({
    workspace: harness.workspace,
    permissionMode: "default",
    accountId: "account-1",
  })
  return harness
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-host-models-"))
  temporaryDirs.push(dir)
  return dir
}
