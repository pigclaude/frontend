// 负责验证上下文占用查询在事件出口出错时仍能继续：一次发出失败不影响之后的查询。

import { describe, expect, it } from "vitest"
import type { SessionContextEvent } from "./context-usage"
import { ContextUsageQuery } from "./context-usage-query"
import type { AdapterEvent } from "./session-events"

const started: AdapterEvent = {
  type: "started",
  sessionId: "sdk-1",
  model: "claude-sonnet",
  tools: [],
  permissionMode: "default",
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await new Promise((done) => setTimeout(done, 0))
}

describe("ContextUsageQuery", () => {
  it("keeps asking after the event outlet throws once", async () => {
    let reads = 0
    const emitted: SessionContextEvent[] = []
    const query = new ContextUsageQuery({
      read: async () => ({ totalTokens: (reads += 1) }),
      emit: (event) => {
        if (reads === 1) throw new Error("listener failed")
        emitted.push(event)
      },
    })

    query.observe(started)
    await settle()
    query.request()
    await settle()

    expect(reads).toBe(2)
    expect(emitted.map((event) => event.usedTokens)).toEqual([2])
  })
})
