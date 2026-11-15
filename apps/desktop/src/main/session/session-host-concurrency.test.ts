// 验证会话宿主的进程上限：满了先停放最久没用的空闲会话，没有空闲的就排队，有空位后按先来先启动；
// 排队排满时报并发已满；排队的会话可以取消。

import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deferred } from "../testing/profile-fixture"
import { ManualClock } from "./session-clock-fixture"
import { createHarness, fixedNow, waitUntil, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost concurrency limit", () => {
  it("parks the least recently used idle session to start one more", async () => {
    const { harness, clock } = await limitedHarness(2)
    const first = await startSession(harness)
    const second = await startSession(harness)
    await finishTurn(harness, second, 1)
    clock.advance(1_000)
    await finishTurn(harness, first, 0)
    clock.advance(1_000)

    const third = await startSession(harness)

    expect(statuses(harness)).toEqual({ [first]: "idle", [second]: "parked", [third]: "idle" })
    expect(harness.runtime.sessions.map((session) => session.closed)).toEqual([false, true, false])
    expect(harness.environments.instances.map((environment) => environment.cleaned)).toEqual([
      0, 1, 0,
    ])
    await harness.host.dispose()
  })

  it("rejects a start with an unavailable workspace without parking another session", async () => {
    const { harness } = await limitedHarness(1)
    const first = await startSession(harness)
    await finishTurn(harness, first, 0)

    await expect(
      harness.host.start({
        workspace: join(harness.workspace, "missing"),
        permissionMode: "default",
      }),
    ).rejects.toMatchObject({ code: "WORKSPACE_UNAVAILABLE" })

    expect(statuses(harness)).toEqual({ [first]: "idle" })
    expect(harness.runtime.sessions).toMatchObject([{ sessionId: first, closed: false }])
    await harness.host.dispose()
  })

  it("queues a new session while every running session is busy and starts it once one stops", async () => {
    const { harness } = await limitedHarness(1)
    const busy = await startSession(harness)
    await harness.host.send(busy, { text: "working" })

    let started = false
    const queued = harness.host
      .start({ sessionId: "queued-1", workspace: harness.workspace, permissionMode: "default" })
      .then((result) => {
        started = true
        return result
      })
    await waitUntil(() => statuses(harness)["queued-1"] === "queued")

    expect(started).toBe(false)
    expect(harness.environments.inputs).toHaveLength(1)
    await harness.host.stop(busy)
    await expect(queued).resolves.toEqual({ sessionId: "queued-1" })
    expect(statuses(harness)).toEqual({ [busy]: "interrupted", "queued-1": "idle" })
    await harness.host.dispose()
  })

  it("starts the queued session only after the stopped session cleans up and revokes its token", async () => {
    const { harness } = await limitedHarness(1)
    const busy = await startSession(harness)
    await harness.host.send(busy, { text: "working" })
    const done = deferred<void>()
    const cleanup = vi
      .spyOn(harness.environments.last, "cleanup")
      .mockImplementation(() => done.promise)
    const waiting = harness.host.start({
      sessionId: "waiting",
      workspace: harness.workspace,
      permissionMode: "default",
    })
    await waitUntil(() => statuses(harness)["waiting"] === "queued")

    const stopped = harness.host.stop(busy)
    try {
      await waitUntil(() => cleanup.mock.calls.length > 0)
      expect(statuses(harness)).toMatchObject({ waiting: "queued" })
      expect(statuses(harness)[busy]).not.toBe("interrupted")
      expect(harness.runtime.sessions).toMatchObject([{ sessionId: busy, closed: true }])
      await expect(harness.host.send(busy, { text: "again" })).rejects.toMatchObject({
        code: "SESSION_RESUME_FAILED",
      })
    } finally {
      done.resolve()
      await stopped
      await waiting
      await harness.host.dispose()
    }
    expect(cleanup).toHaveBeenCalledOnce()
    expect(harness.runtime.sessions[0]?.closed).toBe(true)
  })

  it("starts a queued session once a busy session finishes its turn, parking it as idle", async () => {
    const { harness } = await limitedHarness(1)
    const busy = await startSession(harness)
    const checkpoints: [string, string, string][] = []
    await harness.host.send(busy, { text: "working" }, async (workspace, phase, turnId) => {
      checkpoints.push([workspace, phase, turnId])
    })
    const queued = harness.host.start({ workspace: harness.workspace, permissionMode: "default" })
    await waitUntil(() => harness.host.list().some((summary) => summary.status === "queued"))

    harness.adapters.instances[0]?.emit(resultEvent())

    const { sessionId } = await queued
    const workspace = await realpath(harness.workspace)
    expect(checkpoints).toEqual([
      [workspace, "baseline", "id-2"],
      [workspace, "final", "id-2"],
    ])
    expect(statuses(harness)).toEqual({ [busy]: "parked", [sessionId]: "idle" })
    expect(harness.host.list().find((summary) => summary.sessionId === busy)?.lastTurn).toBe(
      "completed",
    )
    await harness.host.dispose()
  })

  it("starts queued sessions first come first served", async () => {
    const { harness } = await limitedHarness(1)
    const busy = await startSession(harness)
    await harness.host.send(busy, { text: "working" })
    const first = harness.host.start({
      sessionId: "q-1",
      workspace: harness.workspace,
      permissionMode: "default",
    })
    const second = harness.host.start({
      sessionId: "q-2",
      workspace: harness.workspace,
      permissionMode: "default",
    })
    await waitUntil(() => statuses(harness)["q-2"] === "queued")

    await harness.host.stop(busy)
    const firstStarted = await Promise.race([first, second])

    expect(firstStarted.sessionId).toBe("q-1")
    expect(statuses(harness)).toMatchObject({ "q-1": "idle", "q-2": "queued" })
    await harness.host.send("q-1", { text: "not parked for q-2 before its first turn" })
    expect(harness.adapters.instances[1]?.sent).toEqual([
      "not parked for q-2 before its first turn",
    ])
    expect(statuses(harness)).toMatchObject({ "q-1": "running", "q-2": "queued" })
    await harness.host.stop("q-1")
    await expect(second).resolves.toEqual({ sessionId: "q-2" })
    await harness.host.dispose()
  })

  it("reports the limit as reached when the queue is full", async () => {
    const { harness } = await limitedHarness(1, 1)
    const busy = await startSession(harness)
    await harness.host.send(busy, { text: "working" })
    const waiting = harness.host.start({ workspace: harness.workspace, permissionMode: "default" })
    await waitUntil(() => harness.host.list().some((summary) => summary.status === "queued"))

    await expect(
      harness.host.start({
        sessionId: "overflow",
        workspace: harness.workspace,
        permissionMode: "default",
      }),
    ).rejects.toMatchObject({ code: "SESSION_LIMIT_REACHED" })
    expect(harness.host.list().map((summary) => summary.sessionId)).not.toContain("overflow")
    await harness.host.stop()
    await expect(waiting).rejects.toMatchObject({ code: "SESSION_CANCELLED" })
    await harness.host.dispose()
  })

  it("cancels a queued session without creating its environment", async () => {
    const { harness } = await limitedHarness(1)
    const busy = await startSession(harness)
    await harness.host.send(busy, { text: "working" })
    const queued = harness.host.start({
      sessionId: "q-1",
      workspace: harness.workspace,
      permissionMode: "default",
    })
    await waitUntil(() => statuses(harness)["q-1"] === "queued")

    await harness.host.stop("q-1")

    await expect(queued).rejects.toMatchObject({ code: "SESSION_CANCELLED" })
    expect(Object.keys(statuses(harness))).toEqual([busy])
    expect(harness.environments.inputs).toHaveLength(1)
    expect(harness.host.status(busy)).toMatchObject({ active: true })
    await harness.host.dispose()
  })
})

async function limitedHarness(
  maxRunningSessions: number,
  maxQueuedSessions?: number,
): Promise<{ harness: SessionHarness; clock: ManualClock }> {
  const clock = new ManualClock(fixedNow)
  const harness = createHarness({
    workspace: await workspaceDir(),
    now: clock.now,
    timers: clock.timers,
    limits: {
      maxRunningSessions,
      ...(maxQueuedSessions === undefined ? {} : { maxQueuedSessions }),
    },
  })
  return { harness, clock }
}

async function startSession(harness: SessionHarness): Promise<string> {
  const { sessionId } = await harness.host.start({
    workspace: harness.workspace,
    permissionMode: "default",
  })
  return sessionId
}

async function finishTurn(
  harness: SessionHarness,
  sessionId: string,
  adapter: number,
): Promise<void> {
  await harness.host.send(sessionId, { text: "hello" })
  harness.adapters.instances[adapter]?.emit(resultEvent())
  await waitUntil(() => harness.host.status(sessionId).turnId === null)
}

function statuses(harness: SessionHarness): Record<string, string> {
  return Object.fromEntries(
    harness.host
      .list()
      .map((summary) => [summary.sessionId, summary.status])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  )
}

function resultEvent() {
  return {
    type: "result" as const,
    subtype: "success",
    isError: false,
    durationMs: 100,
    numTurns: 1,
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
  }
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-concurrency-"))
  temporaryDirs.push(dir)
  return dir
}
