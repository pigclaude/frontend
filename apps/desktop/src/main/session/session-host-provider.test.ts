// 负责验证 SessionHost 在开发期自定义供应商下的行为：环境替换、固定模型、单项目录、显式切模型和会员门禁。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { DevProviderOverride } from "./dev-provider"
import { createHarness } from "./session-host-fixtures"
import { providerSessionProfile } from "./session-host-provider"
import type { SessionStartInput } from "./session-types"

const pinnedModel = "claude-haiku-5.5"
const provider: DevProviderOverride = {
  baseUrl: "https://provider.example.test",
  authToken: "provider-token-xyz",
  model: pinnedModel,
}

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost with dev provider", () => {
  it("把供应商写进会话环境并覆盖界面选择的模型", async () => {
    const harness = await providerHarness()

    await harness.host.start({ ...startInput(harness.workspace), model: "claude-sonnet-4" })

    expect(harness.environments.inputs[0]?.provider).toEqual({
      baseUrl: provider.baseUrl,
      authToken: provider.authToken,
    })
    expect(harness.adapters.last.startCalls[0]?.model).toBe(provider.model)
    expect(harness.host.status().model).toBe(provider.model)
    await harness.host.dispose()
  })

  it("本机没有可用账号时也能启动", async () => {
    const harness = await providerHarness()
    harness.runtime.availableAccounts = false

    await harness.host.start(startInput(harness.workspace))

    expect(harness.adapters.last.startCalls).toHaveLength(1)
    expect(harness.environments.inputs[0]?.provider).toBeDefined()
    await harness.host.dispose()
  })

  it("返回固定模型的单项目录且不启动适配器", async () => {
    const harness = await providerHarness()

    await expect(harness.host.models()).resolves.toEqual([
      {
        id: provider.model,
        displayName: provider.model,
        description: "开发期自定义供应商",
        isDefault: true,
      },
    ])
    expect(harness.adapters.instances).toHaveLength(0)
    expect(harness.environments.inputs).toHaveLength(0)
    await harness.host.dispose()
  })

  it("供应商下仍然要求有效会员", async () => {
    const harness = await providerHarness("expired")

    await expect(harness.host.models()).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" })
    expect(harness.adapters.instances).toHaveLength(0)
    await harness.host.dispose()
  })

  it("只接受固定模型的切换请求", async () => {
    const harness = await providerHarness()
    await harness.host.start(startInput(harness.workspace))

    await expect(harness.host.setModel("claude-sonnet-4")).rejects.toThrow("已固定模型")
    await harness.host.setModel(pinnedModel)
    expect(harness.adapters.last.modelsSet).toHaveLength(0)
    await harness.host.dispose()
  })

  it("没有固定模型时继续读 CLI 目录", async () => {
    const harness = await providerHarness("active", { ...provider, model: null })

    const models = await harness.host.models()

    expect(models).toEqual(harness.adapters.last.modelsResult)
    expect(harness.adapters.last.modelCalls).toHaveLength(1)
    await harness.host.dispose()
  })
})

describe("providerSessionProfile", () => {
  it("没有账号配置时用宿主语言和时区", () => {
    const profile = providerSessionProfile(null)

    expect(profile.timezone).not.toBe("")
    expect(profile.locale).not.toBe("")
  })

  it("有账号配置时原样保留", () => {
    const profile = { timezone: "America/Los_Angeles", locale: "en-US", accountId: "a" }

    expect(providerSessionProfile(profile)).toEqual(profile)
  })
})

async function providerHarness(
  membershipState: "active" | "expired" = "active",
  override: DevProviderOverride = provider,
) {
  const workspace = await mkdtemp(join(tmpdir(), "pigclaude-provider-host-"))
  temporaryDirs.push(workspace)
  return createHarness({ workspace, membershipState, provider: override })
}

function startInput(workspace: string): SessionStartInput {
  return { workspace, permissionMode: "default" }
}
