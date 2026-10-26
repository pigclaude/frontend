// 负责验证权限请求与 SessionHost 的协作：回答写回、停止顺序、取消、会员失效、超时和模式切换。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import type { PermissionRequestEvent } from "./permission-broker"
import { createHarness, waitUntil, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost permissions", () => {
  it("writes allow and deny answers back to canUseTool", async () => {
    const harness = await startedHarness()
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")

    const allowPromise = canUseTool("Bash", { command: "ls" }, askOptions())
    const allowEvent = await waitForPermission(harness)
    expect(allowEvent).toMatchObject({
      type: "permission",
      toolName: "Bash",
      input: { command: "ls" },
    })
    expect(harness.host.status().pendingPermissions).toBe(1)

    harness.host.respondPermission({
      requestId: allowEvent.requestId,
      decision: "allow",
      updatedPermissions: [
        { type: "addRules", rules: [], behavior: "allow", destination: "session" },
      ],
    })
    await expect(allowPromise).resolves.toMatchObject({ behavior: "allow" })

    const denyPromise = canUseTool("Write", { file_path: "/tmp/x" }, askOptions())
    const denyEvent = await waitForPermission(harness, 2)
    harness.host.respondPermission({ requestId: denyEvent.requestId, decision: "deny" })
    await expect(denyPromise).resolves.toMatchObject({ behavior: "deny" })

    expect(harness.host.status().pendingPermissions).toBe(0)
    const serialized = JSON.stringify(harness.events)
    expect(serialized).not.toContain(harness.runtime.sessionToken)
    await harness.host.dispose()
  })

  it("denies pending permissions before interrupting, stopping and cleaning on stop", async () => {
    const harness = await startedHarness()
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")
    let settled = ""
    const pending = canUseTool("Bash", { command: "rm" }, askOptions()).then((result) => {
      settled = result?.behavior ?? ""
      harness.trace.push("denied")
    })
    await waitForPermission(harness)

    await harness.host.stop()
    await pending

    expect(settled).toBe("deny")
    expect(harness.trace).toEqual(["started", "denied", "interrupted", "stopped", "cleaned"])
    expect(harness.environments.last.cleaned).toBe(1)
    expect(harness.host.status().active).toBe(false)
    await harness.host.dispose()
  })

  it("denies pending permissions on cancel but keeps the session open", async () => {
    const harness = await startedHarness()
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")
    const pending = canUseTool("Bash", { command: "rm" }, askOptions())
    await waitForPermission(harness)

    await harness.host.cancel()

    await expect(pending).resolves.toMatchObject({ behavior: "deny" })
    expect(harness.adapters.last.interrupts).toBe(1)
    expect(harness.host.status()).toMatchObject({ active: true, pendingPermissions: 0 })
    expect(harness.environments.last.cleaned).toBe(0)
    await harness.host.dispose()
  })

  it("stops the session and denies permissions when membership is lost", async () => {
    const harness = await startedHarness()
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")
    const pending = canUseTool("Bash", { command: "rm" }, askOptions())
    await waitForPermission(harness)

    harness.membership.setState("expired")
    await waitUntil(() => !harness.host.status().active)

    await expect(pending).resolves.toMatchObject({ behavior: "deny" })
    expect(harness.adapters.last.stops).toBe(1)
    expect(harness.environments.last.cleaned).toBe(1)
    expect(harness.events).toContainEqual({
      type: "error",
      code: "MEMBERSHIP_REQUIRED",
      message: "会员状态已失效",
    })
    await harness.host.dispose()
  })

  it("denies after ten minutes and ends the turn with PERMISSION_TIMEOUT", async () => {
    const harness = await startedHarness()
    vi.useFakeTimers()
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")

    const pending = canUseTool("Bash", { command: "rm" }, askOptions())
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)

    await expect(pending).resolves.toEqual({
      behavior: "deny",
      message: "权限询问超时",
    })
    expect(harness.events).toContainEqual({
      type: "error",
      code: "PERMISSION_TIMEOUT",
      message: "权限询问超时",
    })
    expect(harness.adapters.last.interrupts).toBe(1)
    vi.useRealTimers()
    await harness.host.dispose()
  })

  it("denies every other pending permission when one request times out", async () => {
    const harness = await startedHarness()
    vi.useFakeTimers()
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")

    const first = canUseTool("Bash", { command: "ls" }, askOptions())
    const second = canUseTool("Write", { file_path: "/tmp/x" }, askOptions())
    expect(harness.host.status().pendingPermissions).toBe(2)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000)

    await expect(first).resolves.toMatchObject({ behavior: "deny" })
    await expect(second).resolves.toMatchObject({ behavior: "deny" })
    expect(harness.host.status().pendingPermissions).toBe(0)
    expect(harness.events.filter((event) => event.type === "permission")).toHaveLength(2)
    vi.useRealTimers()
    await harness.host.dispose()
  })

  it("changes mode and model only for later tool calls and leaves pending requests open", async () => {
    const harness = await startedHarness()
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")
    let settled = false
    const pending = canUseTool("Bash", { command: "rm" }, askOptions()).then(() => {
      settled = true
    })
    const event = await waitForPermission(harness)

    await harness.host.setMode("acceptEdits")
    await harness.host.setModel("claude-opus-4")

    expect(harness.adapters.last.modes).toEqual(["acceptEdits"])
    expect(harness.adapters.last.modelsSet).toEqual(["claude-opus-4"])
    expect(harness.host.status()).toMatchObject({
      permissionMode: "acceptEdits",
      model: "claude-opus-4",
      pendingPermissions: 1,
    })
    expect(settled).toBe(false)

    harness.host.respondPermission({ requestId: event.requestId, decision: "deny" })
    await pending
    expect(settled).toBe(true)
    await harness.host.dispose()
  })
})

function startInput(workspace: string) {
  return { workspace, permissionMode: "default" as const }
}

async function startedHarness(): Promise<SessionHarness> {
  const harness = createHarness({ workspace: await workspaceDir() })
  await harness.host.start(startInput(harness.workspace))
  return harness
}

async function waitForPermission(
  harness: SessionHarness,
  expected = 1,
): Promise<PermissionRequestEvent> {
  await waitUntil(
    () => harness.events.filter((event) => event.type === "permission").length >= expected,
  )
  const events = harness.events.filter(
    (candidate): candidate is PermissionRequestEvent => candidate.type === "permission",
  )
  const event = events.at(-1)
  if (event === undefined) throw new Error("permission event was not emitted")
  return event
}

function askOptions(): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID: "tool-1",
    requestId: "request-1",
  }
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-permissions-"))
  temporaryDirs.push(dir)
  return dir
}
