// 负责验证信封到输入框上下文占用的投影：取最近一条 context 事件，换号不清空，
// 并在时间线里作为最后一条不属于任何一轮的 context.updated 交给对话组件。

import { describe, expect, it } from "vitest"
import type { SessionEnvelope } from "../../../main/session/session-envelope"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { latestSessionContext } from "./session-context-usage"
import { projectTimeline } from "./session-timeline"
import type { SessionTurn } from "./session-model"

let seq = 0

function envelope(event: SessionHostEvent, at = "2026-11-14T01:00:00.000Z"): SessionEnvelope {
  return { version: 1, sessionId: "s-1", seq: (seq += 1), at, event }
}

function context(usedTokens: number, at?: string): SessionEnvelope {
  return envelope({ type: "context", usedTokens, maxTokens: 200_000, autoCompactTokens: null }, at)
}

const switched = envelope({ type: "account-switched", from: "a", to: "b", reason: "switch" })

describe("latestSessionContext", () => {
  it("is empty before the session reports any usage", () => {
    expect(latestSessionContext([switched])).toBeNull()
  })

  it("takes the newest report with its time, and an account switch does not clear it", () => {
    const envelopes = [context(10), context(20, "2026-11-14T01:00:05.000Z"), switched]

    expect(latestSessionContext(envelopes)).toEqual({
      usage: { usedTokens: 20, maxTokens: 200_000, autoCompactTokens: null },
      at: "2026-11-14T01:00:05.000Z",
    })
  })
})

describe("projectTimeline context usage", () => {
  const turn: SessionTurn = {
    id: "turn-1",
    mainTurnId: "main-turn-1",
    afterSeq: 0,
    userText: "hi",
    startedAt: "2026-11-14T01:00:00.000Z",
    endedAt: null,
    status: "streaming",
    endCode: null,
    errors: [],
  }

  it("puts the latest usage after every other event, outside any run", () => {
    const envelopes = [
      envelope({ type: "turn-started", turnId: "main-turn-1" }),
      context(10),
      switched,
    ]

    const { events } = projectTimeline({
      threadId: "s-1",
      record: { envelopes, live: { text: "", reasoning: "" } },
      turns: [turn],
      answers: {},
    })

    expect(events.at(-1)).toMatchObject({
      type: "context.updated",
      runId: null,
      payload: { usedTokens: 10, maxTokens: 200_000, autoCompactTokens: null },
    })
    expect(events.filter((event) => event.type === "context.updated")).toHaveLength(1)
  })
})
