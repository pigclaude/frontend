// 负责验证渲染层的会话事件存储：按会话 id 分开保存，要保存的事件按序号去重和排列，
// 正文与思考的实时增量单独缓冲，落成消息或一轮结束时清掉。

import { describe, expect, it } from "vitest"
import type { SessionEnvelope } from "../../../main/session/session-envelope"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { sessionRecord, storeEnvelope, type SessionEventStore } from "./session-event-store"

function envelope(
  seq: number | null,
  event: SessionHostEvent,
  sessionId: string | null = "s-1",
): SessionEnvelope {
  return { version: 1, sessionId, seq, at: "2026-11-14T01:00:00.000Z", event }
}

function delta(text: string, thinking = false): SessionEnvelope {
  return envelope(null, { type: "delta", text, thinking, blockIndex: 0 })
}

function text(seq: number, value: string, parentToolUseId: string | null = null): SessionEnvelope {
  return envelope(seq, {
    type: "message",
    messageId: `m-${seq}`,
    model: "claude-sonnet",
    subagent: parentToolUseId === null ? null : { parentToolUseId, agentId: null },
    blocks: [{ type: "text", text: value }],
  })
}

function store(...envelopes: SessionEnvelope[]): SessionEventStore {
  return envelopes.reduce<SessionEventStore>(storeEnvelope, {})
}

describe("session event store", () => {
  it("keeps each session's events apart, once per seq and in seq order", () => {
    const first = text(1, "一")
    const result = store(
      first,
      text(3, "三"),
      text(2, "二"),
      first,
      envelope(1, { type: "turn-started", turnId: "t-9" }, "s-2"),
    )

    expect(sessionRecord(result, "s-1").envelopes.map((item) => item.seq)).toEqual([1, 2, 3])
    expect(sessionRecord(result, "s-1").envelopes[0]).toBe(first)
    expect(sessionRecord(result, "s-2").envelopes.map((item) => item.event.type)).toEqual([
      "turn-started",
    ])
    expect(sessionRecord(result, "s-3").envelopes).toEqual([])
  })

  it("returns the same store for an event it already has", () => {
    const once = store(text(1, "一"))
    expect(storeEnvelope(once, text(1, "一"))).toBe(once)
  })

  it("buffers live text and thinking without storing the deltas", () => {
    const result = store(delta("先"), delta("看"), delta("想", true), delta("想", true))

    expect(sessionRecord(result, "s-1")).toEqual({
      envelopes: [],
      live: { text: "先看", reasoning: "想想" },
    })
  })

  it("clears the live text when the main thread's text lands and the thinking when its thinking or a tool does", () => {
    const thinking = envelope(2, {
      type: "message",
      messageId: "m-2",
      model: "claude-sonnet",
      subagent: null,
      blocks: [{ type: "thinking", text: "想想" }],
    })
    const tool = envelope(4, {
      type: "message",
      messageId: "m-4",
      model: "claude-sonnet",
      subagent: null,
      blocks: [{ type: "tool-use", id: "tool-1", name: "Bash", input: {} }],
    })

    expect(sessionRecord(store(delta("想", true), thinking, delta("答")), "s-1").live).toEqual({
      text: "答",
      reasoning: "",
    })
    expect(sessionRecord(store(delta("答"), delta("想", true), text(3, "答")), "s-1").live).toEqual(
      { text: "", reasoning: "想" },
    )
    expect(sessionRecord(store(delta("想", true), tool), "s-1").live.reasoning).toBe("")
    expect(sessionRecord(store(delta("答"), text(3, "子代理", "task-1")), "s-1").live.text).toBe(
      "答",
    )
  })

  it("drops the live buffer when a turn starts or ends and when the session ends", () => {
    const started = envelope(1, { type: "turn-started", turnId: "t-1" })
    const ended = envelope(2, {
      type: "turn-ended",
      turnId: "t-1",
      status: "interrupted",
      errorCode: "SESSION_CANCELLED",
    })
    const closed = envelope(3, { type: "ended", reason: "stopped" })
    const empty = { text: "", reasoning: "" }

    expect(sessionRecord(store(delta("旧"), started), "s-1").live).toEqual(empty)
    expect(
      sessionRecord(store(started, delta("答"), delta("想", true), ended), "s-1").live,
    ).toEqual(empty)
    expect(sessionRecord(store(delta("答"), closed), "s-1").live).toEqual(empty)
  })

  it("leaves events outside any session to the session model", () => {
    const empty = store()
    expect(storeEnvelope(empty, envelope(null, { type: "notice", message: "提示" }, null))).toBe(
      empty,
    )
  })
})
