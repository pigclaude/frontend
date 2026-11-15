// 验证会话停放：空闲 30 分钟自动停放（进行中的回合、待答和后台任务都不算空闲），会员失效时全部停放并标记中断、
// 吊销令牌，关闭主窗口（不带 id 的停止）时全部停放；停放后会话留在列表里，事件仍可补拉。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ManualClock } from "./session-clock-fixture"
import { createHarness, fixedNow, waitUntil, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []
const minute = 60 * 1_000

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost parking", () => {
  it("parks a session that stays idle for 30 minutes", async () => {
    const { harness, clock } = await clockedHarness()
    const sessionId = await startSession(harness)

    clock.advance(30 * minute - 1)
    expect(harness.host.status(sessionId).active).toBe(true)
    clock.advance(1)
    await waitUntil(() => harness.environments.last.cleaned === 1)

    expect(harness.host.status(sessionId).active).toBe(false)
    expect(harness.runtime.sessions[0]?.closed).toBe(true)
    expect(harness.host.list()).toMatchObject([{ sessionId, status: "parked" }])
    await harness.host.dispose()
  })

  it("does not count a running turn as idle and restarts the 30 minutes after it ends", async () => {
    const { harness, clock } = await clockedHarness()
    const sessionId = await startSession(harness)
    await harness.host.send(sessionId, { text: "long task" })

    clock.advance(45 * minute)
    expect(harness.host.status(sessionId).active).toBe(true)
    harness.adapters.last.emit(resultEvent())
    await waitUntil(() => harness.host.status(sessionId).turnId === null)
    clock.advance(29 * minute)
    expect(harness.host.status(sessionId).active).toBe(true)
    clock.advance(minute)

    await waitUntil(() => harness.environments.last.cleaned === 1)
    expect(harness.host.list()).toMatchObject([{ status: "parked", lastTurn: "completed" }])
    await harness.host.dispose()
  })

  it("waits for background shells to finish before counting the session as idle", async () => {
    const { harness, clock } = await clockedHarness()
    const sessionId = await startSession(harness)
    harness.adapters.last.emit({
      type: "background-tasks",
      taskIds: [],
      ambientTaskIds: ["dev-server"],
    })

    clock.advance(40 * minute)
    expect(harness.host.status(sessionId).active).toBe(true)
    harness.adapters.last.emit({ type: "background-tasks", taskIds: [], ambientTaskIds: [] })
    clock.advance(30 * minute)

    await waitUntil(() => harness.environments.last.cleaned === 1)
    await harness.host.dispose()
  })

  it("parks every session as interrupted when membership ends, revoking every token", async () => {
    const { harness } = await clockedHarness()
    const [busy, idle] = [await startSession(harness), await startSession(harness)]
    await harness.host.send(busy, { text: "working" })

    harness.membership.setState("expired")
    await waitUntil(() =>
      harness.environments.instances.every((environment) => environment.cleaned === 1),
    )

    expect(harness.runtime.sessions.map((session) => session.closed)).toEqual([true, true])
    const ended = harness.envelopes.filter((envelope) => envelope.event.type === "turn-ended")
    expect(ended.map((envelope) => [envelope.sessionId, envelope.event])).toEqual([
      [
        busy,
        {
          type: "turn-ended",
          turnId: "id-3",
          status: "interrupted",
          errorCode: "MEMBERSHIP_REQUIRED",
        },
      ],
    ])
    harness.membership.setState("active")
    expect(harness.host.list().map(({ sessionId, status }) => [sessionId, status])).toEqual([
      [busy, "interrupted"],
      [idle, "interrupted"],
    ])
    await expect(harness.host.send(idle, { text: "again" })).rejects.toMatchObject({
      code: "SESSION_RESUME_FAILED",
    })
    await harness.host.dispose()
  })

  it("cancels queued sessions with MEMBERSHIP_REQUIRED when membership ends", async () => {
    const { harness } = await clockedHarness({ maxRunningSessions: 1 })
    const busy = await startSession(harness)
    await harness.host.send(busy, { text: "working" })
    const queued = harness.host.start({ workspace: harness.workspace, permissionMode: "default" })
    await waitUntil(() => harness.host.list().length === 2)

    harness.membership.setState("device_revoked")

    await expect(queued).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" })
    expect(harness.environments.inputs).toHaveLength(1)
    await harness.host.dispose()
  })

  it("retains sessions through a network interruption and parks them only after grace expires", async () => {
    const { harness } = await clockedHarness()
    try {
      const [busy, idle] = [await startSession(harness), await startSession(harness)]
      await harness.host.send(busy, { text: "working" })

      harness.membership.setState("network_grace")
      await expect(harness.host.send(idle, { text: "new request" })).rejects.toMatchObject({
        code: "MEMBERSHIP_REQUIRED",
      })
      expect(harness.host.status(busy)).toMatchObject({ active: true, turnId: expect.any(String) })
      expect(harness.runtime.sessions.map((session) => session.closed)).toEqual([false, false])

      harness.membership.setState("error")
      await waitUntil(() =>
        harness.environments.instances.every((environment) => environment.cleaned === 1),
      )
      harness.membership.setState("active")
      expect(harness.host.list().map((item) => item.status)).toEqual(["interrupted", "interrupted"])
      expect(harness.runtime.sessions.map((session) => session.closed)).toEqual([true, true])
    } finally {
      await harness.host.dispose()
    }
  })

  it("parks every session when the main window closes, keeping their events readable", async () => {
    const { harness } = await clockedHarness()
    const [first, second] = [await startSession(harness), await startSession(harness)]
    await harness.host.send(first, { text: "working" })

    await harness.host.stop()

    expect(harness.environments.instances.map((environment) => environment.cleaned)).toEqual([1, 1])
    expect(harness.runtime.sessions.map((session) => session.closed)).toEqual([true, true])
    expect(harness.host.pendingWork()).toEqual({ turns: 0, approvals: 0 })
    expect(harness.host.list().map(({ sessionId, status }) => [sessionId, status])).toEqual([
      [first, "interrupted"],
      [second, "parked"],
    ])
    expect(harness.host.events(first, 0).map((envelope) => envelope.event.type)).toContain(
      "turn-ended",
    )
    await harness.host.dispose()
  })
})

async function clockedHarness(
  limits: { maxRunningSessions?: number } = {},
): Promise<{ harness: SessionHarness; clock: ManualClock }> {
  const clock = new ManualClock(fixedNow)
  const harness = createHarness({
    workspace: await workspaceDir(),
    now: clock.now,
    timers: clock.timers,
    limits,
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
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-parking-"))
  temporaryDirs.push(dir)
  return dir
}
