// 负责验证会话宿主发出的事件信封：会话 id、时间单调、要保存的事件才有序号，以及按序号补拉。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, describe, expect, it } from "vitest"
import { createHarness, fixedNow } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost envelopes", () => {
  it("stamps each event with the session id, a non-decreasing UTC time and a seq only when kept", async () => {
    let clock = Date.UTC(2026, 10, 14, 1, 0, 0)
    const harness = createHarness({ workspace: await workspaceDir(), now: () => clock })
    const { sessionId } = await harness.host.start({
      workspace: harness.workspace,
      permissionMode: "default",
    })
    const startSeqs = harness.envelopes.map((envelope) => envelope.seq)

    clock = Date.UTC(2026, 10, 14, 1, 0, 5)
    harness.adapters.last.emit({ type: "delta", text: "先看", thinking: false, blockIndex: 0 })
    clock = Date.UTC(2026, 10, 14, 1, 0, 2)
    harness.adapters.last.emit({
      type: "message",
      messageId: "m1",
      model: "claude-sonnet",
      subagent: null,
      blocks: [{ type: "text", text: "先看" }],
    })
    clock = Date.UTC(2026, 10, 14, 1, 0, 9)
    harness.adapters.last.emit({
      type: "tool-result",
      toolUseId: "t1",
      content: "",
      isError: false,
      subagent: null,
    })

    expect(startSeqs).toEqual([1])
    expect(
      harness.envelopes.slice(1).map(({ version, sessionId, seq, at, event }) => ({
        version,
        sessionId,
        seq,
        at,
        type: event.type,
      })),
    ).toEqual([
      { version: 1, sessionId, seq: null, at: "2026-11-14T01:00:05.000Z", type: "delta" },
      { version: 1, sessionId, seq: 2, at: "2026-11-14T01:00:05.000Z", type: "message" },
      { version: 1, sessionId, seq: 3, at: "2026-11-14T01:00:09.000Z", type: "tool-result" },
    ])
    await harness.host.dispose()
  })

  it("reads back kept events after a seq, in order and without live events", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const { sessionId } = await harness.host.start({
      workspace: harness.workspace,
      permissionMode: "default",
    })
    harness.adapters.last.emit({ type: "delta", text: "答", thinking: false, blockIndex: 0 })
    harness.adapters.last.emit({
      type: "tool-result",
      toolUseId: "t1",
      content: "",
      isError: false,
      subagent: null,
    })
    harness.adapters.last.emit({ type: "error", code: "SDK_ERROR", message: "boom" })

    const missed = harness.host.events(sessionId, 1)

    expect(missed.map((envelope) => [envelope.seq, envelope.event.type])).toEqual([
      [2, "tool-result"],
      [3, "error"],
    ])
    expect(missed).toEqual(harness.envelopes.filter((envelope) => (envelope.seq ?? 0) > 1))
    expect(() => harness.host.events("another-session", 0)).toThrow(/SESSION_NOT_FOUND/)
    harness.membership.setState("expired")
    expect(() => harness.host.events(sessionId, 0)).toThrow(/MEMBERSHIP_REQUIRED/)
    await harness.host.dispose()
  })

  it("still reads back a session that has just ended until the next one starts", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const first = await harness.host.start({
      workspace: harness.workspace,
      permissionMode: "default",
    })
    harness.adapters.last.emit({ type: "ended", reason: "completed" })

    expect(harness.host.status().active).toBe(false)
    expect(harness.host.events(first.sessionId, 0).map((envelope) => envelope.event.type)).toEqual([
      "mode",
      "ended",
    ])

    await harness.host.start({ workspace: harness.workspace, permissionMode: "default" })
    expect(() => harness.host.events(first.sessionId, 0)).toThrow(/SESSION_NOT_FOUND/)
    await harness.host.dispose()
  })

  it("sends host notices outside any session without a seq", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })

    harness.usage.failWrite("disk full")

    expect(harness.envelopes).toEqual([
      {
        version: 1,
        sessionId: null,
        seq: null,
        at: new Date(fixedNow).toISOString(),
        event: { type: "error", code: "usage_write_failed", message: "用量记录写入失败" },
      },
    ])
    await harness.host.dispose()
  })

  it("gives permission requests ids that stay unique across sessions", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const requestIds: string[] = []
    for (let round = 0; round < 2; round += 1) {
      const { sessionId } = await harness.host.start({
        workspace: harness.workspace,
        permissionMode: "default",
      })
      await harness.host.send(sessionId, { text: "run ls" })
      void harness.adapters.last.canUseTool?.("Bash", { command: "ls" }, askOptions())
      const request = harness.events.findLast((event) => event.type === "permission")
      if (request?.type === "permission") requestIds.push(request.requestId)
      await harness.host.stop(sessionId)
    }

    expect(requestIds).toHaveLength(2)
    expect(new Set(requestIds).size).toBe(2)
    expect(requestIds.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true)
    await harness.host.dispose()
  })

  it("only lets commands reach the session they name", async () => {
    const harness = createHarness({ workspace: await workspaceDir() })
    const { sessionId } = await harness.host.start({
      workspace: harness.workspace,
      permissionMode: "default",
    })

    await expect(harness.host.send("stale-session", { text: "hello" })).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    })
    await expect(harness.host.setModel("stale-session", "claude-opus")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    })
    await harness.host.cancel("stale-session")
    await harness.host.stop("stale-session")

    expect(harness.adapters.last.sent).toEqual([])
    expect(harness.adapters.last.interrupts).toBe(0)
    expect(harness.host.status()).toMatchObject({ active: true, sessionId })
    await harness.host.dispose()
  })
})

function askOptions(): Parameters<CanUseTool>[2] {
  return { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" }
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-envelopes-"))
  temporaryDirs.push(dir)
  return dir
}
