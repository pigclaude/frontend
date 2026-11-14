// 负责验证权限代理的 allow/deny 写回、取消、超时和事件内容；不接触真实 SDK、网络或磁盘。

import { afterEach, describe, expect, it, vi } from "vitest"
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk"
import { PendingAnswers } from "./pending-answers"
import {
  PermissionBroker,
  type PermissionBrokerOptions,
  type PermissionRequestEvent,
} from "./permission-broker"

const allowOnce: PermissionUpdate = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "ls" }],
  behavior: "allow",
  destination: "session",
}

afterEach(() => {
  vi.useRealTimers()
})

describe("PermissionBroker", () => {
  it("emits one request and writes allow back to canUseTool", async () => {
    const events: PermissionRequestEvent[] = []
    const broker = createBroker({ emit: (request) => events.push(request) })
    const signal = new AbortController().signal

    const pending = broker.request(
      "Bash",
      { command: "ls" },
      { signal, suggestions: [allowOnce], blockedPath: "/tmp/outside" },
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      requestId: "permission-1",
      toolName: "Bash",
      input: { command: "ls" },
      suggestions: [allowOnce],
      blockedPath: "/tmp/outside",
    })

    broker.respond({
      requestId: events[0]?.requestId ?? "",
      decision: "allow",
      updatedPermissions: [allowOnce],
    })

    await expect(pending).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "ls" },
      updatedPermissions: [allowOnce],
    })
    expect(broker.pendingCount).toBe(0)
  })

  it("writes deny back to canUseTool", async () => {
    const events: PermissionRequestEvent[] = []
    const broker = createBroker({ emit: (request) => events.push(request) })

    const pending = broker.request(
      "Write",
      { file_path: "/tmp/secret" },
      { signal: new AbortController().signal },
    )
    broker.respond({ requestId: events[0]?.requestId ?? "", decision: "deny" })

    await expect(pending).resolves.toMatchObject({ behavior: "deny" })
    expect(broker.pendingCount).toBe(0)
  })

  it("denies every pending request immediately when the shared queue rejects all", async () => {
    const events: PermissionRequestEvent[] = []
    const queue = sharedQueue()
    const broker = createBroker({ emit: (request) => events.push(request), queue })

    const first = broker.request("Bash", {}, { signal: new AbortController().signal })
    const second = broker.request("Read", {}, { signal: new AbortController().signal })
    expect(broker.pendingCount).toBe(2)

    queue.rejectAll("会话已停止")

    await expect(first).resolves.toEqual({ behavior: "deny", message: "会话已停止" })
    await expect(second).resolves.toEqual({ behavior: "deny", message: "会话已停止" })
    expect(broker.pendingCount).toBe(0)
  })

  it("denies a request as soon as its AbortSignal aborts and emits nothing", async () => {
    const events: PermissionRequestEvent[] = []
    const broker = createBroker({ emit: (request) => events.push(request) })
    const controller = new AbortController()

    const pending = broker.request("Bash", {}, { signal: controller.signal })
    controller.abort()

    await expect(pending).resolves.toMatchObject({ behavior: "deny" })
    expect(events).toHaveLength(1)
    expect(broker.pendingCount).toBe(0)
  })

  it("does not emit a request when the signal is already aborted", async () => {
    const events: PermissionRequestEvent[] = []
    const broker = createBroker({ emit: (request) => events.push(request) })
    const controller = new AbortController()
    controller.abort()

    await expect(broker.request("Bash", {}, { signal: controller.signal })).resolves.toMatchObject({
      behavior: "deny",
    })
    expect(events).toHaveLength(0)
  })

  it("denies after ten minutes without an answer and reports the timeout", async () => {
    vi.useFakeTimers()
    const events: PermissionRequestEvent[] = []
    const timeouts: string[] = []
    const broker = createBroker({
      emit: (request) => events.push(request),
      onTimeout: (request) => timeouts.push(request.requestId),
    })

    const pending = broker.request("Bash", {}, { signal: new AbortController().signal })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 - 1)
    expect(timeouts).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toMatchObject({ behavior: "deny", message: "权限询问超时" })
    expect(timeouts).toEqual(["permission-1"])
    expect(broker.pendingCount).toBe(0)
  })

  it("ignores answers for unknown or already settled requests", async () => {
    const events: PermissionRequestEvent[] = []
    const broker = createBroker({ emit: (request) => events.push(request) })
    const pending = broker.request("Bash", {}, { signal: new AbortController().signal })

    broker.respond({ requestId: events[0]?.requestId ?? "", decision: "deny" })
    broker.respond({ requestId: events[0]?.requestId ?? "", decision: "allow" })
    broker.respond({ requestId: "missing", decision: "allow" })

    await expect(pending).resolves.toMatchObject({ behavior: "deny" })
    expect(broker.pendingCount).toBe(0)
  })

  it("rejects malformed updatedPermissions instead of forwarding them to the SDK", () => {
    const events: PermissionRequestEvent[] = []
    const broker = createBroker({ emit: (request) => events.push(request) })
    void broker.request("Bash", {}, { signal: new AbortController().signal })

    expect(() =>
      broker.respond({
        requestId: events[0]?.requestId ?? "",
        decision: "allow",
        updatedPermissions: [{ type: "not-a-permission-update" }],
      }),
    ).toThrow(/permission/i)
  })

  it("does not include internal handles or secrets in the emitted request", () => {
    const events: PermissionRequestEvent[] = []
    const broker = createBroker({ emit: (request) => events.push(request) })
    const controller = new AbortController()

    void broker.request(
      "Bash",
      { command: "echo hi" },
      { signal: controller.signal, blockedPath: "/tmp/x" },
    )

    expect(Object.keys(events[0] ?? {}).sort()).toEqual([
      "blockedPath",
      "input",
      "requestId",
      "subagent",
      "toolName",
      "type",
    ])
    expect(events[0]?.subagent).toBeNull()
    controller.abort()
  })
})

/** 和会话里一样的共用待答队列：10 分钟超时，真实定时器（测试里可以换成假定时器）。 */
function sharedQueue(): PendingAnswers {
  return new PendingAnswers({
    timeoutMs: 10 * 60 * 1_000,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle),
  })
}

function createBroker(overrides: Partial<PermissionBrokerOptions> = {}): PermissionBroker {
  let next = 0
  return new PermissionBroker({
    queue: sharedQueue(),
    emit: () => undefined,
    newRequestId: () => `permission-${(next += 1)}`,
    ...overrides,
  })
}
