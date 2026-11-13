// 负责验证 SessionHost 的模型目录查询：临时环境、账号凭据、隔离环境与失败清理。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createHarness, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost models", () => {
  it("queries models in a temporary environment even with an active session", async () => {
    const harness = await startedHarness()

    const models = await harness.host.models()

    expect(models).toHaveLength(1)
    expect(harness.environments.inputs).toHaveLength(2)
    expect(harness.adapters.last.modelCalls[0]).toEqual({
      workspace: harness.workspace,
      env: harness.environments.last.env,
      binaryPath: "/fake/claude",
    })
    expect(harness.environments.last.cleaned).toBe(1)
    await harness.host.dispose()
  })

  it("passes the resolved account credentials to the model environment", async () => {
    const modelAuth = {
      accessToken: "account-token",
      accountUuid: "account-uuid",
      email: "model@example.test",
      organizationUuid: "organization-uuid",
    }
    const harness = createHarness({ workspace: await workspaceDir(), resolveModelAuth: modelAuth })

    await harness.host.models()

    expect(harness.environments.inputs[0]).toMatchObject({ modelAuth })
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

  it("cleans the temporary environment when the model query fails", async () => {
    const harness = createHarness({
      workspace: await workspaceDir(),
      modelsError: new Error("MODEL_QUERY_TIMEOUT: 模型查询超时"),
    })

    await expect(harness.host.models()).rejects.toMatchObject({ code: "SDK_ERROR" })
    expect(harness.environments.inputs).toHaveLength(1)
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
