// 负责验证适配器把 model/thinking/effort/fast 固定进 query 选项，把模式/模型切换转发给运行中的 query，
// 并把 Claude Code 报告的权限模式转成会话事件。

import { describe, expect, it } from "vitest"
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { ClaudeAgentAdapter, type AdapterEvent } from "./claude-agent-adapter"
import {
  capture,
  FakeQuery,
  startOptions,
  waitUntil,
  type CapturedQuery,
} from "./claude-agent-adapter-fixtures"

describe("ClaudeAgentAdapter controls", () => {
  it("passes the requested model and thinking budget into query options", async () => {
    const fake = new FakeQuery()
    const captured: CapturedQuery[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, captured),
      resolveBinaryPath: () => "/resolved/claude",
    })

    await adapter.start({
      ...startOptions(),
      binaryPath: "/explicit/claude",
      model: "claude-opus-4",
      thinking: "high",
    })

    expect(captured[0]?.options.model).toBe("claude-opus-4")
    expect(captured[0]?.options.thinking).toEqual({ type: "enabled", budgetTokens: 16_384 })
    await adapter.stop()
  })

  it("maps off to disabled thinking", async () => {
    const fake = new FakeQuery()
    const captured: CapturedQuery[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, captured),
      resolveBinaryPath: () => "/resolved/claude",
    })

    await adapter.start({ ...startOptions(), thinking: "off" })

    expect(captured[0]?.options.thinking).toEqual({ type: "disabled" })
    await adapter.stop()
  })

  it("prefers the SDK effort level over a token budget and enables fast mode", async () => {
    const fake = new FakeQuery()
    const captured: CapturedQuery[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, captured),
      resolveBinaryPath: () => "/resolved/claude",
    })

    await adapter.start({ ...startOptions(), effort: "xhigh", thinking: "high", fast: true })

    expect(captured[0]?.options.effort).toBe("xhigh")
    expect(captured[0]?.options.thinking).toBeUndefined()
    expect(captured[0]?.options.settings).toEqual({ fastMode: true })
    await adapter.stop()
  })

  it("forwards mode and model changes to the running query", async () => {
    const fake = new FakeQuery()
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
    })
    await adapter.start(startOptions())

    await adapter.setPermissionMode("acceptEdits")
    await adapter.setModel("claude-sonnet-4")

    expect(fake.permissionModes).toEqual(["acceptEdits"])
    expect(fake.modelChanges).toEqual(["claude-sonnet-4"])

    await adapter.stop()
    await expect(adapter.setPermissionMode("plan")).rejects.toThrow(/not active/)
    await expect(adapter.setModel("claude-opus-4")).rejects.toThrow(/not active/)
  })

  it("reports the permission mode from status messages and skips those without one", async () => {
    const fake = new FakeQuery()
    const events: AdapterEvent[] = []
    const adapter = new ClaudeAgentAdapter({
      queryFn: capture(fake, []),
      resolveBinaryPath: () => "/resolved/claude",
      onEvent: (event) => events.push(event),
    })
    await adapter.start(startOptions())

    fake.emit(statusMessage({ status: "compacting" }))
    fake.emit(statusMessage({ status: null, permissionMode: "auto" }))
    await waitUntil(() => events.length > 0)

    expect(events).toEqual([{ type: "mode", permissionMode: "auto" }])
    await adapter.stop()
  })
})

function statusMessage(fields: {
  status: "compacting" | null
  permissionMode?: string
}): SDKMessage {
  return {
    type: "system",
    subtype: "status",
    ...fields,
    uuid: "00000000-0000-4000-8000-000000000009",
    session_id: "sdk-session",
  } as unknown as SDKMessage
}
