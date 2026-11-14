// 测试 ClaudeSession 不经会话宿主、只用测试替身构造时的一轮对话、权限超时、结束路径和脱敏。

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import { ClaudeSession } from "./claude-session"
import { AdapterFactory, fixedNow, waitUntil } from "./session-host-fixtures"
import type { SessionEnvironmentPort, SessionHostEvent } from "./session-types"
import type { UsageRecord } from "./usage-recorder"

const token = "per-session-token"
const interruptedResult: SessionHostEvent = {
  type: "result",
  subtype: "error_during_execution",
  isError: true,
  durationMs: 900,
  numTurns: 1,
  stopReason: null,
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
}

function fakeEnvironment(): SessionEnvironmentPort & { cleaned: number } {
  return {
    env: {},
    configDir: "/sessions/s-1/claude",
    sessionDir: "/sessions/s-1",
    workspace: "/workspace",
    binaryPath: "/fake/claude",
    timezone: "Asia/Shanghai",
    cleaned: 0,
    async cleanup() {
      this.cleaned += 1
    },
  }
}

function standaloneSession() {
  const adapters = new AdapterFactory([])
  const environment = fakeEnvironment()
  const events: SessionHostEvent[] = []
  const usage: UsageRecord[] = []
  const released: ClaudeSession[] = []
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
  let nextId = 0
  const session = new ClaudeSession({
    sessionId: "s-1",
    input: { workspace: "/workspace", permissionMode: "default" },
    environment,
    createAdapter: adapters.create,
    emit: (envelope) => events.push(envelope.event),
    recordUsage: (record) => usage.push(record),
    sessionToken: () => token,
    provider: null,
    permissionTimeoutMs: 60_000,
    timers: {
      set: (callback) => {
        const handle = setTimeout(() => undefined, 0)
        timers.set(handle, callback)
        return handle
      },
      clear: (handle) => {
        timers.delete(handle)
        clearTimeout(handle)
      },
    },
    now: () => fixedNow,
    newId: () => `turn-${(nextId += 1)}`,
    onReleased: (session) => released.push(session),
  })
  const fireTimers = (): void => {
    for (const [handle, fire] of [...timers]) {
      if (!timers.delete(handle)) continue
      clearTimeout(handle)
      fire()
    }
  }
  return { session, adapters, environment, events, usage, released, timers, fireTimers }
}

describe("ClaudeSession", () => {
  it("runs a turn from launch to a usage record without a session host", async () => {
    const { session, adapters, events, usage } = standaloneSession()

    await session.launch(undefined)
    await session.send({ text: "hello" })
    adapters.last.emit({ ...interruptedResult, subtype: "success", isError: false })

    expect(adapters.last.sent).toEqual(["hello"])
    expect(usage).toMatchObject([{ sessionId: "s-1", turnId: "turn-1", status: "success" }])
    expect(events.map((event) => event.type)).toEqual(["turn-started", "result", "turn-ended"])
    expect(session.status()).toMatchObject({ active: true, sessionId: "s-1", turnId: null })
  })

  it("denies an unanswered permission and ends the turn when its own timer fires", async () => {
    const { session, adapters, events, fireTimers } = standaloneSession()
    await session.launch(undefined)
    await session.send({ text: "run ls" })
    const canUseTool = adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")

    const answer = canUseTool("Bash", { command: "ls" }, askOptions())
    fireTimers()
    adapters.last.emit(interruptedResult)

    await expect(answer).resolves.toMatchObject({ behavior: "deny" })
    expect(events).toContainEqual({
      type: "error",
      code: "PERMISSION_TIMEOUT",
      message: "权限询问超时",
    })
    await waitUntil(() => session.pendingWork().turns === 0)
    expect(adapters.last.interrupts).toBe(1)
    expect(events.at(-1)).toEqual({
      type: "turn-ended",
      turnId: "turn-1",
      status: "error",
      errorCode: "PERMISSION_TIMEOUT",
    })
  })

  it("gives up waiting for an interrupted reply and keeps its late result out of the next turn", async () => {
    const { session, adapters, events, timers, fireTimers } = standaloneSession()
    await session.launch(undefined)
    await session.send({ text: "long answer" })

    const cancelling = session.cancel()
    await waitUntil(() => timers.size === 1)
    fireTimers()
    await cancelling
    await session.send({ text: "next" })
    adapters.last.emit(interruptedResult)
    const afterLateResult = session.status().turnId
    adapters.last.emit({ ...interruptedResult, subtype: "success", isError: false })

    expect(afterLateResult).toBe("turn-2")
    expect(events.filter((event) => event.type === "turn-ended")).toMatchObject([
      { turnId: "turn-1", status: "interrupted" },
      { turnId: "turn-2", status: "completed" },
    ])
  })

  it("ends once, cleans its environment and tells its owner", async () => {
    const { session, adapters, environment, released } = standaloneSession()
    await session.launch(undefined)

    const first = session.end("会话已停止", null)
    const second = session.end("会话已停止", null)
    await first

    expect(second).toBe(first)
    expect(adapters.last.stops).toBe(1)
    expect(environment.cleaned).toBe(1)
    expect(released).toEqual([session])
    expect(session.closing).toBe(true)
  })

  it("removes the daemon session token from errors it forwards", async () => {
    const { session, adapters, events } = standaloneSession()
    await session.launch(undefined)

    adapters.last.emit({ type: "error", code: "SDK_ERROR", message: `upstream saw ${token}` })

    expect(events).toEqual([
      { type: "error", code: "SDK_ERROR", message: "upstream saw [redacted]" },
    ])
  })
})

function askOptions(): Parameters<CanUseTool>[2] {
  return { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" }
}
