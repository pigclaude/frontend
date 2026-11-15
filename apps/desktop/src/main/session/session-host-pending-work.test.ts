// 负责验证会话宿主为退出确认汇总运行中会话、正在进行的回合和待审批请求。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import {
  createHarness,
  currentSessionId,
  waitUntil,
  type SessionHarness,
} from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost pending work", () => {
  it("includes idle background sessions and excludes parked sessions", async () => {
    const harness = await startedHarness()
    const first = currentSessionId(harness.host)
    const { workspace } = harness.environments.last
    await harness.host.start({ workspace, permissionMode: "default" })
    await harness.host.start({ workspace, permissionMode: "default" })
    await harness.host.stop(first)

    expect(harness.host.pendingWork()).toEqual({ runningSessions: 2, turns: 0, approvals: 0 })
    await harness.host.dispose()
  })

  it("counts the running turn and the permissions waiting for an answer", async () => {
    const harness = await startedHarness()
    await harness.host.send(currentSessionId(harness.host), { text: "hello" })
    void askPermission(harness)
    await waitUntil(() => harness.host.status().pendingPermissions === 1)

    expect(harness.host.pendingWork()).toEqual({ runningSessions: 1, turns: 1, approvals: 1 })
    await harness.host.dispose()
  })

  it("keeps counting the session once its turn has a result", async () => {
    const harness = await startedHarness()
    await harness.host.send(currentSessionId(harness.host), { text: "hello" })
    harness.adapters.last.emit({
      type: "result",
      subtype: "success",
      isError: false,
      durationMs: 10,
      numTurns: 1,
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    })

    expect(harness.host.pendingWork()).toEqual({ runningSessions: 1, turns: 0, approvals: 0 })
    await harness.host.dispose()
  })

  it("stops counting as soon as the session starts ending", async () => {
    const harness = await startedHarness()
    await harness.host.send(currentSessionId(harness.host), { text: "hello" })
    void askPermission(harness)
    await waitUntil(() => harness.host.status().pendingPermissions === 1)

    const stopping = harness.host.stop()

    expect(harness.host.pendingWork()).toEqual({ runningSessions: 0, turns: 0, approvals: 0 })
    await stopping
  })
})

async function startedHarness(): Promise<SessionHarness> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-pending-work-"))
  temporaryDirs.push(dir)
  const harness = createHarness({ workspace: dir })
  await harness.host.start({ workspace: dir, permissionMode: "default" })
  return harness
}

function askPermission(harness: SessionHarness): ReturnType<CanUseTool> {
  const canUseTool = harness.adapters.last.canUseTool
  if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")
  return canUseTool(
    "Bash",
    { command: "ls" },
    { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" },
  )
}
