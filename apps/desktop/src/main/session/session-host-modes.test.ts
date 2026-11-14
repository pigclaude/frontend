// 负责验证会话宿主的权限模式规则：自动审批先经 Claude Code 核实，被拒时说明原因并落到真实模式；
// 界面始终跟随 CLI 报告的模式，CLI 自己收回自动审批时提示；批准计划前先回到原档。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import type { PermissionRequestEvent } from "./permission-broker"
import {
  autoModeRefusal,
  createHarness,
  currentSessionId,
  waitUntil,
  type SessionHarness,
} from "./session-host-fixtures"
import type { SessionPermissionMode } from "./session-types"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost permission modes", () => {
  it("starts an auto session supervised and switches to auto before start resolves", async () => {
    const harness = await harnessFor()

    await harness.host.start(startInput(harness, "auto"))

    expect(harness.adapters.last.startCalls[0]?.permissionMode).toBe("default")
    expect(harness.adapters.last.modes).toEqual(["auto"])
    expect(harness.host.status().permissionMode).toBe("auto")
    expect(harness.events.at(-1)).toEqual({ type: "mode", permissionMode: "auto" })
    expect(notices(harness)).toEqual([])
    await harness.host.dispose()
  })

  it("announces the starting mode of every session", async () => {
    const harness = await harnessFor()

    await harness.host.start(startInput(harness, "acceptEdits"))

    expect(harness.adapters.last.startCalls[0]?.permissionMode).toBe("acceptEdits")
    expect(harness.adapters.last.modes).toEqual([])
    expect(harness.events).toEqual([{ type: "mode", permissionMode: "acceptEdits" }])
    await harness.host.dispose()
  })

  it("keeps a new session supervised and explains why when auto is refused", async () => {
    const harness = await harnessFor()
    harness.adapters.onCreate((adapter) => {
      adapter.autoRefusal = autoModeRefusal(
        "auto_mode_model",
        "auto mode unavailable for this model",
      )
    })

    await harness.host.start(startInput(harness, "auto"))

    expect(harness.host.status().permissionMode).toBe("default")
    expect(notices(harness)).toEqual(["自动审批不可用：当前模型不支持。会话按监督审批运行。"])
    expect(harness.events.at(-1)).toEqual({ type: "mode", permissionMode: "default" })
    await harness.host.dispose()
  })

  it("keeps a new session supervised when Claude Code cannot be asked about auto", async () => {
    const harness = await harnessFor()
    harness.adapters.onCreate((adapter) => {
      adapter.modeError = new Error("session is not active")
    })

    await harness.host.start(startInput(harness, "auto"))

    expect(harness.host.status().permissionMode).toBe("default")
    expect(notices(harness)).toEqual([
      "自动审批不可用：session is not active。会话按监督审批运行。",
    ])
    await harness.host.dispose()
  })

  it("keeps the current level when Claude Code refuses auto mid-session", async () => {
    const harness = await startedHarness("acceptEdits")
    harness.adapters.last.autoRefusal = autoModeRefusal(
      "auto_mode_circuit_breaker",
      "auto mode is unavailable for your plan",
    )

    await harness.host.setMode(currentSessionId(harness.host), "auto")

    expect(harness.adapters.last.modes).toEqual(["auto"])
    expect(harness.host.status().permissionMode).toBe("acceptEdits")
    expect(notices(harness)).toEqual([
      "自动审批不可用：当前 Claude 账号的订阅不支持。会话按接受编辑运行。",
    ])
    await harness.host.dispose()
  })

  it("asks the user to retry when Claude Code has not decided about auto yet", async () => {
    const harness = await startedHarness("default")
    harness.adapters.last.autoRefusal = autoModeRefusal(
      "auto_mode_unavailable",
      "auto mode availability is not known yet · ask again",
    )

    await harness.host.setMode(currentSessionId(harness.host), "auto")

    expect(notices(harness)).toEqual([
      "自动审批不可用：Claude Code 还没确认能否使用，请稍后再试。会话按监督审批运行。",
    ])
    await harness.host.dispose()
  })

  it("leaves plan for supervised approval when the remembered auto level is refused", async () => {
    const harness = await startedHarness("plan")
    harness.adapters.last.autoRefusal = autoModeRefusal(
      "auto_mode_fast_mode",
      "auto mode unavailable while fast mode is on · run /fast off",
    )

    await harness.host.setMode(currentSessionId(harness.host), "auto")

    expect(harness.adapters.last.modes).toEqual(["auto", "default"])
    expect(harness.host.status().permissionMode).toBe("default")
    expect(notices(harness)).toEqual([
      "自动审批不可用：快速模式开启时不能使用。已关闭计划，会话按监督审批运行。",
    ])
    await harness.host.dispose()
  })

  it("reports other mode failures as errors and keeps the mode", async () => {
    const harness = await startedHarness("default")
    harness.adapters.last.modeError = new Error(
      "Cannot set permission mode to bypassPermissions because it is disabled by settings",
    )

    await expect(
      harness.host.setMode(currentSessionId(harness.host), "bypassPermissions"),
    ).rejects.toThrow(/^SDK_ERROR: Cannot/)

    expect(harness.host.status().permissionMode).toBe("default")
    expect(notices(harness)).toEqual([])
    await harness.host.dispose()
  })

  it("follows the mode Claude Code reports, including the one in each turn's init", async () => {
    const harness = await startedHarness("default")

    harness.adapters.last.emit({ type: "mode", permissionMode: "plan" })
    expect(harness.host.status().permissionMode).toBe("plan")
    expect(harness.events.at(-1)).toEqual({ type: "mode", permissionMode: "plan" })

    harness.adapters.last.emit({
      type: "started",
      sessionId: "native-1",
      model: "claude-sonnet",
      tools: [],
      permissionMode: "acceptEdits",
    })
    expect(harness.host.status().permissionMode).toBe("acceptEdits")
    expect(notices(harness)).toEqual([])
    await harness.host.dispose()
  })

  it("tells the user when Claude Code turns auto off by itself", async () => {
    const harness = await startedHarness("auto")

    harness.adapters.last.emit({ type: "mode", permissionMode: "default" })

    expect(harness.host.status().permissionMode).toBe("default")
    expect(notices(harness)).toEqual(["Claude Code 关闭了自动审批，会话按监督审批运行。"])
    await harness.host.dispose()
  })

  it("does not mistake a requested switch away from auto for Claude Code turning it off", async () => {
    const harness = await startedHarness("auto")

    await harness.host.setMode(currentSessionId(harness.host), "acceptEdits")
    harness.adapters.last.lateModeEvents = true
    await harness.host.setMode(currentSessionId(harness.host), "auto")
    await harness.host.setMode(currentSessionId(harness.host), "default")
    await waitUntil(() => modes(harness).at(-1) === "default")

    expect(harness.host.status().permissionMode).toBe("default")
    expect(notices(harness)).toEqual([])
    await harness.host.dispose()
  })

  it("returns to the remembered level before an approved plan is released", async () => {
    const harness = await startedHarness("plan")
    const canUseTool = harness.adapters.last.canUseTool
    if (canUseTool === null) throw new Error("canUseTool was not passed to the adapter")
    let settled = false
    const approval = canUseTool("ExitPlanMode", { plan: "改两处" }, askOptions()).then((result) => {
      settled = true
      return result
    })
    const request = await waitForPermission(harness)

    await harness.host.setMode(currentSessionId(harness.host), "acceptEdits")

    expect(harness.adapters.last.modes).toEqual(["acceptEdits"])
    expect(harness.host.status()).toMatchObject({
      permissionMode: "acceptEdits",
      pendingPermissions: 1,
    })
    expect(settled).toBe(false)

    await harness.host.respondPermission(currentSessionId(harness.host), {
      requestId: request.requestId,
      decision: "allow",
    })
    const result = await approval
    expect(result).toMatchObject({ behavior: "allow" })
    expect(result).not.toHaveProperty("updatedPermissions")
    await harness.host.dispose()
  })
})

function startInput(harness: SessionHarness, permissionMode: SessionPermissionMode) {
  return { workspace: harness.workspace, permissionMode }
}

async function harnessFor(): Promise<SessionHarness> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-modes-"))
  temporaryDirs.push(dir)
  return createHarness({ workspace: dir })
}

async function startedHarness(permissionMode: SessionPermissionMode): Promise<SessionHarness> {
  const harness = await harnessFor()
  await harness.host.start(startInput(harness, permissionMode))
  return harness
}

function notices(harness: SessionHarness): string[] {
  return harness.events.flatMap((event) =>
    event.type === "notice" && "message" in event ? [event.message] : [],
  )
}

function modes(harness: SessionHarness): string[] {
  return harness.events.flatMap((event) => (event.type === "mode" ? [event.permissionMode] : []))
}

async function waitForPermission(harness: SessionHarness): Promise<PermissionRequestEvent> {
  await waitUntil(() => harness.events.some((event) => event.type === "permission"))
  const event = harness.events.find(
    (candidate): candidate is PermissionRequestEvent => candidate.type === "permission",
  )
  if (event === undefined) throw new Error("permission event was not emitted")
  return event
}

function askOptions(): Parameters<CanUseTool>[2] {
  return { signal: new AbortController().signal, toolUseID: "tool-1", requestId: "request-1" }
}
