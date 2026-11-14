// 负责验证投影里进行中的一轮：正在输出的正文和思考作为实时文字交给组件，最后一段正文在这一轮结束前
// 留在流式回答的位置，结束后才落成回答；迟到的事件和主进程开轮前到达的事件归到正确的一轮。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { projectTimeline, type SessionTimeline } from "./session-timeline"

const t0 = "2026-11-14T01:00:00.000Z"
const started: SessionHostEvent = { type: "turn-started", turnId: "main-1" }
const completed: SessionHostEvent = {
  type: "turn-ended",
  turnId: "main-1",
  status: "completed",
  errorCode: null,
}

function sent(text = "你好"): SessionUiState {
  const state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  return reduceSession(state, { type: "user-message", text, turnId: "turn-1", at: t0 })
}

function feed(state: SessionUiState, ...events: SessionHostEvent[]): SessionUiState {
  return events.reduce((current, event) => receive(current, event), state)
}

function project(state: SessionUiState): SessionTimeline {
  return projectTimeline({
    threadId: "thread-1",
    record: sessionRecord(state.events, state.sessionId),
    turns: state.turns,
    answers: state.answers,
  })
}

function delta(text: string, thinking = false): SessionHostEvent {
  return { type: "delta", text, thinking, blockIndex: 0 }
}

function text(messageId: string, value: string, parentToolUseId: string | null = null) {
  return {
    type: "message",
    messageId,
    model: "claude-sonnet",
    subagent: parentToolUseId === null ? null : { parentToolUseId, agentId: null },
    blocks: [{ type: "text", text: value }],
  } satisfies SessionHostEvent
}

function bash(id: string): SessionHostEvent {
  return {
    type: "message",
    messageId: `m-${id}`,
    model: "claude-sonnet",
    subagent: null,
    blocks: [{ type: "tool-use", id, name: "Bash", input: { command: "ls" } }],
  }
}

describe("projectTimeline while a turn runs", () => {
  it("hands the text and thinking being written to the open turn", () => {
    const timeline = project(feed(sent(), started, delta("想", true), delta("先看"), delta("一下")))

    expect(timeline.streamingText).toBe("先看一下")
    expect(timeline.liveReasoning).toBe("想")
    expect(timeline.events.map((event) => event.type)).toEqual(["run.started"])
  })

  it("keeps the last text in the streaming answer until the turn ends, then lands it as the answer", () => {
    const running = feed(sent(), started, delta("答"), text("m1", "答案"))
    const ended = feed(running, completed)

    expect(project(running).streamingText).toBe("答案")
    expect(project(running).events.map((event) => event.type)).toEqual(["run.started"])
    expect(project(ended).streamingText).toBe("")
    expect(project(ended).events.map((event) => event.type)).toEqual([
      "run.started",
      "message.completed",
      "run.completed",
    ])
    expect(project(ended).events[1]?.payload).toEqual({ text: "答案" })
  })

  it("moves the held text into the work once a tool call follows it", () => {
    const state = feed(sent(), started, text("m1", "先跑测试"), bash("tool-1"))
    const timeline = project(state)

    expect(timeline.streamingText).toBe("")
    expect(timeline.events.map((event) => event.type)).toEqual([
      "run.started",
      "message.completed",
      "tool.started",
    ])
  })

  it("streams the next text instead of the held one while it is being written", () => {
    const state = feed(sent(), started, text("m1", "第一段"), delta("第二"))
    const timeline = project(state)

    expect(timeline.streamingText).toBe("第二")
    expect(timeline.events.map((event) => event.type)).toEqual(["run.started", "message.completed"])
  })

  it("does not hold a subagent's text as the answer", () => {
    const state = feed(sent(), started, text("m1", "子代理说的", "task-1"))
    expect(project(state).streamingText).toBe("")
  })

  it("keeps the text being written in place after a stop until the main process lands it", () => {
    const writing = feed(
      sent(),
      started,
      text("m1", "先跑测试"),
      bash("tool-1"),
      delta("改好了一半"),
    )
    const stopped = reduceSession(writing, { type: "cancel-requested", at: t0 })
    const landed = feed(stopped, text("unfinished-main-1", "改好了一半"), {
      type: "turn-ended",
      turnId: "main-1",
      status: "interrupted",
      errorCode: "SESSION_CANCELLED",
    })
    const shown = (state: SessionUiState) =>
      project(state).events.map((event) => [event.type, event.payload])

    expect(shown(stopped)).toEqual([
      ["run.started", { agentId: "claude", text: "你好" }],
      ["message.completed", { text: "先跑测试" }],
      ["tool.started", { toolCallId: "tool-1", name: "Bash", input: { command: "ls" } }],
      ["message.completed", { text: "改好了一半" }],
      ["run.interrupted", {}],
    ])
    expect(project(stopped).streamingText).toBe("")
    expect(shown(landed)).toEqual(shown(stopped))
  })

  it("keeps a held answer in place after a stop", () => {
    const stopped = reduceSession(feed(sent(), started, text("m1", "答案")), {
      type: "cancel-requested",
      at: t0,
    })
    expect(project(stopped).events.map((event) => event.type)).toEqual([
      "run.started",
      "message.completed",
      "run.interrupted",
    ])
  })

  it("has no live text once no turn is open", () => {
    const state = feed(sent(), started, completed, delta("迟到"))
    expect(project(state)).toMatchObject({ streamingText: "", liveReasoning: "" })
  })

  it("puts events that arrive before the main process opens the turn into the turn just sent", () => {
    let state = feed(sent(), bash("tool-1"))
    expect(project(state).events.map((event) => [event.type, event.runId])).toEqual([
      ["run.started", "run-1"],
      ["tool.started", "run-1"],
    ])

    state = feed(state, started, completed)
    expect(state.turns).toHaveLength(1)
    expect(project(state).events.map((event) => [event.type, event.runId])).toEqual([
      ["run.started", "run-1"],
      ["tool.started", "run-1"],
      ["run.completed", "run-1"],
    ])
  })

  it("keeps a late tool result with the turn that already ended", () => {
    let state = feed(sent("一"), started, bash("tool-1"), completed, {
      type: "tool-result",
      toolUseId: "tool-1",
      content: "ok",
      isError: false,
      subagent: null,
    })
    state = reduceSession(state, { type: "user-message", text: "二", turnId: "turn-2", at: t0 })
    state = feed(state, { type: "turn-started", turnId: "main-2" }, text("m2", "第二轮"), {
      type: "turn-ended",
      turnId: "main-2",
      status: "completed",
      errorCode: null,
    })
    const runOf = (runId: string) =>
      project(state)
        .events.filter((event) => event.runId === runId)
        .map((event) => event.type)

    expect(state.turns.map((turn) => turn.userText)).toEqual(["一", "二"])
    expect(runOf("run-1")).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
      "run.completed",
    ])
    expect(runOf("run-2")).toEqual(["run.started", "message.completed", "run.completed"])
  })

  it("shows a message that failed to send as its own failed turn", () => {
    let state = feed(sent("一"), started, completed)
    state = reduceSession(state, { type: "user-message", text: "二", turnId: "turn-2", at: t0 })
    state = reduceSession(state, {
      type: "failed",
      message: "已有活动会话",
      code: "SESSION_ALREADY_ACTIVE",
      at: t0,
    })
    state = reduceSession(state, { type: "user-message", text: "三", turnId: "turn-3", at: t0 })
    state = feed(state, { type: "turn-started", turnId: "main-3" }, text("m3", "第三轮"))
    const runs = project(state).events.map((event) => [event.runId, event.type])

    expect(runs).toEqual([
      ["run-1", "run.started"],
      ["run-1", "run.completed"],
      ["run-2", "run.started"],
      ["run-2", "run.failed"],
      ["run-3", "run.started"],
    ])
    expect(project(state).streamingText).toBe("第三轮")
  })
})
