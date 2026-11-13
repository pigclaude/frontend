// 负责验证适配器把 model/thinking/effort/fast 固定进 query 选项，并把模式/模型切换转发给运行中的 query。

import { describe, expect, it } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import {
  capture,
  FakeQuery,
  startOptions,
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
})
