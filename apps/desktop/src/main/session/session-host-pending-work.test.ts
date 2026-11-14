// 负责验证会话宿主报告的「退出会中断的工作」：进行中的回合和待回答的权限，正在结束的会话不算。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { createHarness, waitUntil, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost pending work", () => {
  it("counts the running turn and the permissions waiting for an answer", async () => {
    const harness = await startedHarness()
    await harness.host.send({ text: "hello" })
    void askPermission(harness)
    await waitUntil(() => harness.host.status().pendingPermissions === 1)

    expect(harness.host.pendingWork()).toEqual({ turns: 1, approvals: 1 })
    await harness.host.dispose()
  })

  it("has nothing pending once the turn has its result", async () => {
    const harness = await startedHarness()
    await harness.host.send({ text: "hello" })
    harness.adapters.last.emit({
      type: "result",
      subtype: "success",
      isError: false,
      durationMs: 10,
      numTurns: 1,
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    })

    expect(harness.host.pendingWork()).toEqual({ turns: 0, approvals: 0 })
    await harness.host.dispose()
  })

  it("stops counting as soon as the session starts ending", async () => {
    const harness = await startedHarness()
    await harness.host.send({ text: "hello" })
    void askPermission(harness)
    await waitUntil(() => harness.host.status().pendingPermissions === 1)

    const stopping = harness.host.stop()

    expect(harness.host.pendingWork()).toEqual({ turns: 0, approvals: 0 })
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
