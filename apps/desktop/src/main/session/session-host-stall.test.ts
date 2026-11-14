// 验证会话宿主在长时间没有 SDK 消息时提示一次，并在等待权限和提问期间暂停计时。

import type { SDKToolProgressMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadSdkFixture, replay, startReplay, type ReplayHarness } from "./session-replay-fixtures"

const minute = 60_000
const toolHeartbeat: SDKToolProgressMessage = {
  type: "tool_progress",
  tool_use_id: "tool-1",
  tool_name: "Bash",
  parent_tool_use_id: null,
  elapsed_time_seconds: 60,
  uuid: "00000000-0000-4000-8000-000000000001",
  session_id: "session",
}

let harness: ReplayHarness

beforeEach(async () => {
  vi.useFakeTimers()
  harness = await startReplay(process.cwd(), "default", () => Date.now())
})

afterEach(async () => {
  await harness?.host.dispose()
  vi.useRealTimers()
})

function stalled(): unknown[] {
  return harness.events.filter(
    (event) => event.type === "notice" && "key" in event && event.key === "run.stalled",
  )
}

describe("SessionHost stall notices", () => {
  it("resets on a tool heartbeat and warns just once per turn without interrupting", async () => {
    await harness.host.send(harness.sessionId, { text: "work" })
    await vi.advanceTimersByTimeAsync(minute)
    replay(harness.query, [toolHeartbeat])
    await vi.advanceTimersByTimeAsync(2 * minute - 1)
    expect(stalled()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(stalled()).toEqual([
      { type: "notice", key: "run.stalled", level: "warning", params: { seconds: "120" } },
    ])
    expect(harness.host.status().turnId).not.toBeNull()
    expect(harness.query.interrupts).toBe(0)

    replay(harness.query, [toolHeartbeat])
    await vi.advanceTimersByTimeAsync(2 * minute)
    expect(stalled()).toHaveLength(1)
  })

  it("counts SDK background progress as activity after the main reply", async () => {
    const messages = loadSdkFixture("workflow-2.1.310")
    const reply = messages.findIndex((message) => message.type === "result")
    const progress = messages[reply + 1]
    if (reply === -1 || progress?.type !== "system" || progress.subtype !== "task_progress") {
      throw new Error("workflow fixture changed")
    }
    await harness.host.send(harness.sessionId, { text: "work" })
    replay(harness.query, messages.slice(0, reply + 1))
    await vi.advanceTimersByTimeAsync(minute)
    replay(harness.query, [progress])
    await vi.advanceTimersByTimeAsync(minute)
    expect(stalled()).toHaveLength(0)
    expect(harness.host.status().turnId).not.toBeNull()
    await vi.advanceTimersByTimeAsync(minute)
    expect(stalled()).toHaveLength(1)
  })

  it("preserves idle time and resumes only after all approvals and questions settle", async () => {
    await harness.host.send(harness.sessionId, { text: "work" })
    await vi.advanceTimersByTimeAsync(minute)
    const signal = new AbortController()
    const askOptions = { signal: signal.signal, toolUseID: "tool-1", requestId: "request-1" }
    const permission = harness.canUseTool("Bash", { command: "pwd" }, askOptions)
    const question = harness.canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "继续？",
            header: "继续",
            options: [
              { label: "是", description: "" },
              { label: "否", description: "" },
            ],
            multiSelect: false,
          },
        ],
      },
      askOptions,
    )
    await vi.advanceTimersByTimeAsync(2 * minute)
    expect(stalled()).toHaveLength(0)
    const request = harness.events.find((event) => event.type === "permission")
    if (!request) throw new Error("permission was not issued")
    harness.host.respondPermission(harness.sessionId, {
      requestId: request.requestId,
      decision: "deny",
    })
    await permission
    await vi.advanceTimersByTimeAsync(2 * minute)
    expect(stalled()).toHaveLength(0)

    signal.abort()
    await question
    await vi.advanceTimersByTimeAsync(minute - 1)
    expect(stalled()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(stalled()).toHaveLength(1)
  })

  it("clears an unfinished timer on stop and starts afresh on a later turn", async () => {
    await harness.host.send(harness.sessionId, { text: "work" })
    await vi.advanceTimersByTimeAsync(minute)
    const cancelling = harness.host.cancel(harness.sessionId)
    await vi.advanceTimersByTimeAsync(2 * minute)
    await cancelling
    expect(stalled()).toHaveLength(0)

    await harness.host.send(harness.sessionId, { text: "more work" })
    await vi.advanceTimersByTimeAsync(2 * minute)
    expect(stalled()).toHaveLength(1)
  })
})
