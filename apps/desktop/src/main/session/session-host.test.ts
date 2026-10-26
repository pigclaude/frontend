// 负责验证 SessionHost 的启动前置条件、单活动会话、事件转发、用量记录、模型查询和停止清理。

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { SessionStartInput } from "./session-types"
import { createHarness, waitUntil, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost start", () => {
  it("does not create an environment or adapter when membership is not active", async () => {
    const harness = createHarness({
      workspace: await workspaceDir(),
      membershipState: "expired",
    })

    await expect(harness.host.start(startInput(harness.workspace))).rejects.toMatchObject({
      code: "MEMBERSHIP_REQUIRED",
    })

    expect(harness.environments.inputs).toHaveLength(0)
    expect(harness.adapters.instances).toHaveLength(0)
    expect(harness.host.status().active).toBe(false)
    await harness.host.dispose()
  })

  it("rejects a second start while a session is active", async () => {
    const harness = await startedHarness()

    await expect(harness.host.start(startInput(harness.workspace))).rejects.toMatchObject({
      code: "SESSION_ALREADY_ACTIVE",
    })
    expect(harness.environments.inputs).toHaveLength(1)
    await harness.host.dispose()
  })

  it("rejects missing, relative and non-directory workspaces", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const missing = join(harness.workspace, "missing")
    const filePath = join(harness.workspace, "file")
    await writeFile(filePath, "x")

    await expect(harness.host.start(startInput(missing))).rejects.toMatchObject({
      code: "WORKSPACE_UNAVAILABLE",
    })
    await expect(harness.host.start(startInput("relative/path"))).rejects.toMatchObject({
      code: "WORKSPACE_UNAVAILABLE",
    })
    await expect(harness.host.start(startInput(filePath))).rejects.toMatchObject({
      code: "WORKSPACE_UNAVAILABLE",
    })
    expect(harness.environments.inputs).toHaveLength(0)
    await harness.host.dispose()
  })

  it("rejects when the daemon has no loopback base url", async () => {
    const harness = createHarness({
      workspace: await workspaceDir(),
      daemonBaseUrl: null,
    })

    await expect(harness.host.start(startInput(harness.workspace))).rejects.toMatchObject({
      code: "DAEMON_UNAVAILABLE",
    })
    expect(harness.environments.inputs).toHaveLength(0)
    await harness.host.dispose()
  })

  it("creates one isolated environment and passes model, thinking and preference to the adapter", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })

    const result = await harness.host.start({
      ...startInput(harness.workspace),
      model: "claude-opus-4",
      thinking: "high",
      accountId: "account-1",
    })

    expect(result.sessionId).toBe("id-1")
    expect(harness.environments.inputs[0]).toMatchObject({
      sessionId: "id-1",
      workspace: harness.workspace,
      daemonBaseUrl: "http://127.0.0.1:47821",
      sessionToken: harness.runtime.sessionToken,
      timezone: "America/Los_Angeles",
      locale: "en-US",
      binaryPath: "/fake/claude",
    })
    expect(harness.adapters.last.startCalls[0]).toMatchObject({
      workspace: harness.workspace,
      permissionMode: "default",
      model: "claude-opus-4",
      thinking: "high",
      binaryPath: "/fake/claude",
      env: harness.environments.last.env,
    })
    expect(harness.runtime.preferredAccount).toBe("account-1")
    expect(harness.host.status()).toMatchObject({
      active: true,
      sessionId: "id-1",
      model: "claude-opus-4",
      permissionMode: "default",
      accountId: "account-1",
      pendingPermissions: 0,
    })
    await harness.host.dispose()
  })
})

describe("SessionHost events and usage", () => {
  it("forwards adapter events and records result metadata", async () => {
    const harness = await startedHarness()
    const adapter = harness.adapters.last

    adapter.emit(startedEvent("claude-sonnet-4"))
    adapter.emit({ type: "delta", text: "Hel", thinking: false, blockIndex: 0 })
    await harness.host.send({ text: "hello" })
    adapter.emit(resultEvent())

    await waitUntil(() => harness.usage.records.length === 1)

    expect(harness.events.map((event) => event.type)).toEqual(["started", "delta", "result"])
    expect(harness.usage.records[0]).toMatchObject({
      schemaVersion: 1,
      sessionId: "id-1",
      turnId: "id-2",
      accountId: "account-1",
      model: "claude-sonnet-4",
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      durationMs: 1_200,
      status: "success",
      errorCode: null,
      switchedFrom: null,
    })
    expect(adapter.sent).toEqual(["hello"])
    await harness.host.dispose()
  })

  it("marks an interrupted turn as cancelled and keeps the session open", async () => {
    const harness = await startedHarness()
    await harness.host.send({ text: "long task" })

    await harness.host.cancel()
    harness.adapters.last.emit(resultEvent({ isError: true }))
    await waitUntil(() => harness.usage.records.length === 1)

    expect(harness.usage.records[0]).toMatchObject({
      status: "cancelled",
      errorCode: "SESSION_CANCELLED",
    })
    expect(harness.host.status().active).toBe(true)
    expect(harness.adapters.last.interrupts).toBe(1)
    expect(harness.environments.last.cleaned).toBe(0)
    await harness.host.dispose()
  })

  it("merges runtime account switches and records switchedFrom without credentials", async () => {
    const harness = await startedHarness()
    harness.runtime.switchAccount(null, "account-a", "initial")
    harness.runtime.switchAccount("account-a", "account-b", "quota")

    expect(harness.events.filter((event) => event.type === "account-switched")).toEqual([
      { type: "account-switched", from: null, to: "account-a", reason: "initial" },
      { type: "account-switched", from: "account-a", to: "account-b", reason: "quota" },
    ])

    await harness.host.send({ text: "hello" })
    harness.adapters.last.emit(resultEvent())
    await waitUntil(() => harness.usage.records.length === 1)

    expect(harness.usage.records[0]).toMatchObject({
      accountId: "account-b",
      switchedFrom: "account-a",
    })
    const serialized = JSON.stringify(harness.events)
    expect(serialized).not.toContain(harness.runtime.sessionToken)
    expect(serialized).not.toContain("proxy-password")
    await harness.host.dispose()
  })

  it("redacts the daemon session token from error events", async () => {
    const harness = await startedHarness()

    harness.adapters.last.emit({
      type: "error",
      code: "SDK_ERROR",
      message: `request failed with ${harness.runtime.sessionToken}`,
    })

    const error = harness.events.at(-1)
    expect(error).toMatchObject({ type: "error", code: "SDK_ERROR" })
    expect(error?.type === "error" ? error.message : "").not.toContain(harness.runtime.sessionToken)
    await harness.host.dispose()
  })

  it("turns a usage write failure into an event without blocking the session", async () => {
    const harness = await startedHarness()

    harness.usage.failWrite("用量记录写入失败")

    expect(harness.events.at(-1)).toEqual({
      type: "error",
      code: "usage_write_failed",
      message: "用量记录写入失败",
    })
    await expect(harness.host.send({ text: "still works" })).resolves.toBeUndefined()
    expect(harness.adapters.last.sent).toEqual(["still works"])
    expect(harness.host.status().active).toBe(true)
    await harness.host.dispose()
  })

  it("rejects send when no session is active", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })

    await expect(harness.host.send({ text: "hello" })).rejects.toThrow(/会话未开始/)
    expect(harness.host.status()).toEqual({
      active: false,
      sessionId: null,
      model: null,
      permissionMode: "default",
      accountId: null,
      pendingPermissions: 0,
      turnId: null,
    })
    await harness.host.dispose()
  })
})

describe("SessionHost models", () => {
  it("queries models with the active session environment", async () => {
    const harness = await startedHarness()

    const models = await harness.host.models()

    expect(models).toHaveLength(1)
    expect(harness.adapters.last.modelCalls[0]).toEqual({
      workspace: harness.workspace,
      env: harness.environments.last.env,
      binaryPath: "/fake/claude",
    })
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

describe("SessionHost stop", () => {
  it("removes the real session directory and allows a new session afterwards", async () => {
    const userDataPath = await workspaceDir()
    const harness = createHarness({
      workspace: await workspaceDir(),
      userDataPath,
      useRealEnvironment: true,
    })

    const first = await harness.host.start(startInput(harness.workspace))
    const sessionDir = join(userDataPath, "sessions", first.sessionId)
    expect((await stat(sessionDir)).isDirectory()).toBe(true)

    await harness.host.stop()
    await expect(stat(sessionDir)).rejects.toMatchObject({ code: "ENOENT" })
    expect(harness.host.status().active).toBe(false)

    const second = await harness.host.start(startInput(harness.workspace))
    expect(second.sessionId).not.toBe(first.sessionId)
    expect((await stat(join(userDataPath, "sessions", second.sessionId))).isDirectory()).toBe(true)
    await harness.host.dispose()
  })
})

function startInput(workspace: string): SessionStartInput {
  return { workspace, permissionMode: "default" }
}

function startedEvent(model: string) {
  return {
    type: "started" as const,
    sessionId: "sdk-session",
    model,
    tools: ["Read"],
    permissionMode: "default" as const,
  }
}

function resultEvent(overrides: { isError?: boolean } = {}) {
  return {
    type: "result" as const,
    subtype: overrides.isError === true ? "error_during_execution" : "success",
    isError: overrides.isError ?? false,
    durationMs: 1_200,
    numTurns: 1,
    stopReason: "end_turn",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    },
  }
}

async function startedHarness(): Promise<SessionHarness> {
  const harness = createHarness({ workspace: await workspaceDir() })
  await harness.host.start({ ...startInput(harness.workspace), accountId: "account-1" })
  return harness
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-host-"))
  temporaryDirs.push(dir)
  return dir
}
