// 负责验证 SDK 上下文占用查询的回复怎么变成 context 事件：用随包 CLI 录制的 summary 回复，
// 以及缺字段、自动压缩关闭、负数和非数字这些边界。

import { describe, expect, it } from "vitest"
import { contextEventFromReply } from "./context-usage"
import { loadContextReply } from "./session-replay-fixtures"

function recordedReply(): Record<string, unknown> {
  return loadContextReply() as Record<string, unknown>
}

describe("contextEventFromReply", () => {
  it("reads the used tokens, window and auto-compact line from a recorded summary reply", () => {
    expect(contextEventFromReply(recordedReply())).toEqual({
      type: "context",
      usedTokens: 35_002,
      maxTokens: 200_000,
      autoCompactTokens: 167_000,
    })
  })

  it("has no auto-compact line when auto-compact is off, even if a threshold is reported", () => {
    const reply = { ...recordedReply(), isAutoCompactEnabled: false }

    expect(contextEventFromReply(reply)?.autoCompactTokens).toBeNull()
  })

  it("leaves the window and the auto-compact line empty when the reply lacks them", () => {
    expect(contextEventFromReply({ totalTokens: 1_200, isAutoCompactEnabled: true })).toEqual({
      type: "context",
      usedTokens: 1_200,
      maxTokens: null,
      autoCompactTokens: null,
    })
  })

  it("rounds fractional counts, clamps negative usage to zero and drops a non-positive window", () => {
    const reply = { totalTokens: -3, maxTokens: 0, autoCompactThreshold: 150_000.6 }

    expect(contextEventFromReply(reply)).toEqual({
      type: "context",
      usedTokens: 0,
      maxTokens: null,
      autoCompactTokens: 150_001,
    })
    expect(contextEventFromReply({ totalTokens: 812.4 })?.usedTokens).toBe(812)
  })

  it("has no result when the used tokens are not a finite number or the reply is not an object", () => {
    expect(contextEventFromReply({ totalTokens: "35002", maxTokens: 200_000 })).toBeNull()
    expect(contextEventFromReply({ totalTokens: Number.NaN })).toBeNull()
    expect(contextEventFromReply({ total_tokens: 35_002, max_tokens: 200_000 })).toBeNull()
    expect(contextEventFromReply(null)).toBeNull()
    expect(contextEventFromReply("35002")).toBeNull()
  })
})
