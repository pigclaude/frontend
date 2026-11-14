// 验证会话宿主同时运行多个会话：每个会话有自己的适配器和回合，重复启动同一个会话返回原 id，
// 回合未结束时拒绝第二条消息，一个会话出错、停止、换号或额度用尽不影响另一个会话。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createHarness, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost with several sessions", () => {
  it("starts a second session while the first keeps running, each on its own adapter", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })

    const first = await harness.host.start({
      workspace: harness.workspace,
      permissionMode: "default",
    })
    const second = await harness.host.start({
      workspace: harness.workspace,
      permissionMode: "default",
    })
    await harness.host.send(first.sessionId, { text: "one" })
    await harness.host.send(second.sessionId, { text: "two" })

    expect(second.sessionId).not.toBe(first.sessionId)
    expect(harness.adapters.instances.map((adapter) => adapter.sent)).toEqual([["one"], ["two"]])
    expect(harness.host.status(first.sessionId)).toMatchObject({ active: true, turnId: "id-3" })
    expect(harness.host.status(second.sessionId)).toMatchObject({ active: true, turnId: "id-4" })
    await harness.host.dispose()
  })

  it("returns the original id when the same session is started again", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const input = {
      sessionId: "draft-1",
      workspace: harness.workspace,
      permissionMode: "default" as const,
    }

    const [first, repeated] = await Promise.all([
      harness.host.start(input),
      harness.host.start(input),
    ])
    const later = await harness.host.start(input)

    expect([first, repeated, later]).toEqual([
      { sessionId: "draft-1" },
      { sessionId: "draft-1" },
      { sessionId: "draft-1" },
    ])
    expect(harness.environments.inputs).toHaveLength(1)
    expect(harness.adapters.instances).toHaveLength(1)
    await harness.host.dispose()
  })

  it("refuses a second message while the turn is open, without touching another session", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const first = await startSession(harness)
    const second = await startSession(harness)

    await harness.host.send(first, { text: "one" })

    await expect(harness.host.send(first, { text: "again" })).rejects.toMatchObject({
      code: "TURN_ACTIVE",
    })
    await expect(harness.host.send(second, { text: "two" })).resolves.toBeUndefined()
    expect(harness.adapters.instances.map((adapter) => adapter.sent)).toEqual([["one"], ["two"]])
    await harness.host.dispose()
  })

  it("keeps a stopped session parked: its events stay readable and new messages fail to resume", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const first = await startSession(harness)
    const second = await startSession(harness)

    await harness.host.stop(first)

    expect(harness.environments.instances.map((environment) => environment.cleaned)).toEqual([1, 0])
    expect(harness.runtime.sessions.map((session) => session.closed)).toEqual([true, false])
    expect(harness.host.status(first)).toMatchObject({ active: false, sessionId: first })
    expect(harness.host.events(first, 0).at(-1)?.event).toMatchObject({ type: "ended" })
    await expect(harness.host.send(first, { text: "hello" })).rejects.toMatchObject({
      code: "SESSION_RESUME_FAILED",
    })
    await expect(
      harness.host.start({
        sessionId: first,
        workspace: harness.workspace,
        permissionMode: "default",
      }),
    ).rejects.toMatchObject({ code: "SESSION_RESUME_FAILED" })
    await expect(harness.host.send(second, { text: "still here" })).resolves.toBeUndefined()
    await harness.host.dispose()
  })
})

describe("SessionHost active turns by workspace", () => {
  it("reports a running turn only for the workspace it runs in and folders inside it", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const other = await workspaceDir()
    const busy = await startSession(harness)
    await startSession(harness, other)

    await harness.host.send(busy, { text: "working" })

    expect(harness.host.hasActiveTurn(harness.workspace)).toBe(true)
    expect(harness.host.hasActiveTurn(join(harness.workspace, "packages", "app"))).toBe(true)
    expect(harness.host.hasActiveTurn(other)).toBe(false)
    await harness.host.stop(busy)
    expect(harness.host.hasActiveTurn(harness.workspace)).toBe(false)
    await harness.host.dispose()
  })

  it("hands the turn id to the workbench checkpoints taken around a turn", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const sessionId = await startSession(harness)
    const checkpoints: [string, string, string][] = []

    await harness.host.send(sessionId, { text: "edit" }, async (workspace, phase, turnId) => {
      checkpoints.push([workspace, phase, turnId])
    })
    harness.adapters.last.emit({
      type: "result",
      subtype: "success",
      isError: false,
      durationMs: 1,
      numTurns: 1,
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    })

    expect(checkpoints).toEqual([
      [harness.workspace, "baseline", "id-2"],
      [harness.workspace, "final", "id-2"],
    ])
    await harness.host.dispose()
  })
})

async function startSession(
  harness: SessionHarness,
  workspace = harness.workspace,
): Promise<string> {
  const { sessionId } = await harness.host.start({ workspace, permissionMode: "default" })
  return sessionId
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-registry-"))
  temporaryDirs.push(dir)
  return dir
}
