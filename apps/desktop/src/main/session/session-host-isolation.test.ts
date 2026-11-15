// 验证同时运行的会话互不影响：一个会话出错退出、被停止、换号或额度用尽时，另一个会话的回合、账号、
// 令牌和环境都不变，还能照常发送。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createHarness, waitUntil, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost isolates concurrent sessions", () => {
  it("keeps the other session's turn running when one session's Claude Code fails and exits", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const [failing, healthy] = [await startSession(harness), await startSession(harness)]
    await harness.host.send(failing, { text: "a" })
    await harness.host.send(healthy, { text: "b" })
    const [failingAdapter, healthyAdapter] = harness.adapters.instances

    failingAdapter?.emit({ type: "error", code: "SDK_ERROR", message: "boom" })
    failingAdapter?.emit({ type: "ended", reason: "error" })
    await waitUntil(() => harness.environments.instances[0]?.cleaned === 1)

    expect(harness.host.status(failing)).toMatchObject({ active: false })
    expect(harness.host.status(healthy)).toMatchObject({ active: true, turnId: "id-4" })
    expect(harness.runtime.sessions.map((session) => session.closed)).toEqual([true, false])
    expect(healthyAdapter?.interrupts).toBe(0)
    expect(harness.host.list().map(({ sessionId, status }) => [sessionId, status])).toEqual([
      [failing, "failed"],
      [healthy, "running"],
    ])
    await harness.host.dispose()
  })

  it("applies an account switch and a quota swap only to the session they belong to", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const first = await startSession(harness, "account-1")
    const second = await startSession(harness, "account-2")
    harness.runtime.switchAccount(null, "account-1", "initial", first)
    harness.runtime.switchAccount(null, "account-2", "initial", second)
    await harness.host.send(first, { text: "a" })
    await harness.host.send(second, { text: "b" })

    harness.runtime.switchAccount("account-1", "account-3", "quota", first)
    harness.adapters.instances[0]?.emit(resultEvent())
    harness.adapters.instances[1]?.emit(resultEvent())
    await waitUntil(() => harness.usage.records.length === 2)

    expect(harness.host.status(first).accountId).toBe("account-3")
    expect(harness.host.status(second).accountId).toBe("account-2")
    expect(
      harness.usage.records.map(({ sessionId, accountId, switchedFrom }) => ({
        sessionId,
        accountId,
        switchedFrom,
      })),
    ).toEqual([
      { sessionId: first, accountId: "account-3", switchedFrom: "account-1" },
      { sessionId: second, accountId: "account-2", switchedFrom: null },
    ])
    const switched = harness.envelopes.filter(
      (envelope) => envelope.event.type === "account-switched",
    )
    expect(switched.map((envelope) => envelope.sessionId)).toEqual([first, second, first])
    await harness.host.dispose()
  })

  it("stops only the session it is asked to stop, leaving the other turn and its approvals", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const [stopped, running] = [await startSession(harness), await startSession(harness)]
    await harness.host.send(stopped, { text: "a" })
    await harness.host.send(running, { text: "b" })

    await harness.host.stop(stopped)

    const ended = harness.envelopes.filter((envelope) => envelope.event.type === "turn-ended")
    expect(ended.map((envelope) => envelope.sessionId)).toEqual([stopped])
    expect(harness.host.status(running)).toMatchObject({ active: true, turnId: "id-4" })
    expect(harness.host.pendingWork()).toEqual({ runningSessions: 1, turns: 1, approvals: 0 })
    await harness.host.dispose()
  })
})

describe("SessionHost permission ids across sessions", () => {
  it("gives each session's permission request its own id and answers only within that session", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const [first, second] = [await startSession(harness), await startSession(harness)]
    const ask = (index: number) =>
      harness.adapters.instances[index]?.canUseTool?.(
        "Bash",
        { command: "ls" },
        { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" },
      )
    const firstAnswer = ask(0)
    const secondAnswer = ask(1)
    await waitUntil(
      () => harness.events.filter((event) => event.type === "permission").length === 2,
    )
    const [firstRequest, secondRequest] = harness.envelopes.flatMap((envelope) =>
      envelope.event.type === "permission" ? [[envelope.sessionId, envelope.event.requestId]] : [],
    )

    expect(firstRequest?.[0]).toBe(first)
    expect(secondRequest?.[0]).toBe(second)
    expect(firstRequest?.[1]).not.toBe(secondRequest?.[1])
    await harness.host.respondPermission(first, {
      requestId: String(secondRequest?.[1]),
      decision: "allow",
    })
    expect(harness.host.status(second).pendingPermissions).toBe(1)
    expect(harness.host.list().find((summary) => summary.sessionId === second)?.status).toBe(
      "waiting-approval",
    )
    await harness.host.respondPermission(second, {
      requestId: String(secondRequest?.[1]),
      decision: "deny",
    })
    await expect(secondAnswer).resolves.toMatchObject({ behavior: "deny" })
    await harness.host.stop(first)
    await expect(firstAnswer).resolves.toMatchObject({ behavior: "deny" })
    await harness.host.dispose()
  })
})

async function startSession(harness: SessionHarness, accountId?: string): Promise<string> {
  const { sessionId } = await harness.host.start({
    workspace: harness.workspace,
    permissionMode: "default",
    ...(accountId === undefined ? {} : { accountId }),
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
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-isolation-"))
  temporaryDirs.push(dir)
  return dir
}
