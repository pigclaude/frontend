// 负责验证信封到时间线事件的投影：一轮里思考、正文、工具和子代理按信封顺序成为线程事件，
// 带真实时间；消息和工具按 id 去重，权限请求与回答、换号和各种结束方式。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { projectTimeline, type SessionTimeline } from "./session-timeline"

const t0 = "2026-11-14T01:00:00.000Z"

function sent(text = "你好", at = t0): SessionUiState {
  const state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  return reduceSession(state, { type: "user-message", text, turnId: "turn-1", at })
}

function feed(state: SessionUiState, ...items: Array<[SessionHostEvent, string?]>): SessionUiState {
  return items.reduce((current, [event, at]) => receive(current, event, at ?? t0), state)
}

function project(state: SessionUiState): SessionTimeline {
  return projectTimeline({
    threadId: "thread-1",
    record: sessionRecord(state.events, state.sessionId),
    turns: state.turns,
    answers: state.answers,
  })
}

function types(state: SessionUiState): string[] {
  return project(state).events.map((event) => event.type)
}

function message(
  messageId: string,
  blocks: Extract<SessionHostEvent, { type: "message" }>["blocks"],
  extra: { thinkingMs?: number; parentToolUseId?: string } = {},
): SessionHostEvent {
  return {
    type: "message",
    messageId,
    model: "claude-sonnet",
    parentToolUseId: extra.parentToolUseId ?? null,
    blocks,
    ...(extra.thinkingMs === undefined ? {} : { thinkingMs: extra.thinkingMs }),
  }
}

const started: SessionHostEvent = { type: "turn-started", turnId: "main-1" }
const completed: SessionHostEvent = {
  type: "turn-ended",
  turnId: "main-1",
  status: "completed",
  errorCode: null,
}

describe("projectTimeline", () => {
  it("has no events before anything is sent", () => {
    const state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
    expect(project(state)).toEqual({
      events: [],
      streamingText: "",
      liveReasoning: "",
      lastRunId: null,
    })
  })

  it("maps one turn in envelope order with real times and increasing seqs", () => {
    const state = feed(
      sent(),
      [started, "2026-11-14T01:00:00.200Z"],
      [
        message("m1", [{ type: "thinking", text: "想一想" }], { thinkingMs: 3_600 }),
        "2026-11-14T01:00:04.000Z",
      ],
      [message("m1", [{ type: "text", text: "答" }]), "2026-11-14T01:00:09.000Z"],
      [
        message("m1", [{ type: "tool-use", id: "tool-1", name: "Bash", input: { command: "ls" } }]),
        "2026-11-14T01:00:09.000Z",
      ],
      [
        { type: "tool-result", toolUseId: "tool-1", content: "ok", isError: false },
        "2026-11-14T01:00:41.500Z",
      ],
      [completed, "2026-11-14T01:01:02.000Z"],
    )
    const { events, lastRunId } = project(state)

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "reasoning.completed",
      "message.completed",
      "tool.started",
      "tool.completed",
      "run.completed",
    ])
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(events.every((event) => event.threadId === "thread-1")).toBe(true)
    expect(events.every((event) => event.runId === "run-1")).toBe(true)
    expect(events[0]?.payload).toEqual({ agentId: "claude", text: "你好" })
    expect(events[1]?.payload).toEqual({ text: "想一想", durationMs: 3_600 })
    expect(events[3]?.payload).toMatchObject({
      toolCallId: "tool-1",
      name: "Bash",
      input: { command: "ls" },
    })
    expect(events[4]?.payload).toMatchObject({ toolCallId: "tool-1", output: "ok", isError: false })
    expect(events.map((event) => event.createdAt)).toEqual([
      "2026-11-14T01:00:00.000Z",
      "2026-11-14T01:00:04.000Z",
      "2026-11-14T01:00:09.000Z",
      "2026-11-14T01:00:09.000Z",
      "2026-11-14T01:00:41.500Z",
      "2026-11-14T01:01:02.000Z",
    ])
    expect(lastRunId).toBe("run-1")
  })

  it("leaves out a thinking block's duration when the main process did not time it", () => {
    const state = feed(sent(), [started], [message("m1", [{ type: "thinking", text: "想" }])])
    expect(project(state).events[1]?.payload).toEqual({ text: "想" })
  })

  it("emits each block of a message id once and keeps a tool where it first appeared", () => {
    const tool = { type: "tool-use" as const, id: "tool-1", name: "Bash", input: { command: "ls" } }
    const state = feed(
      sent(),
      [started],
      [message("m1", [{ type: "thinking", text: "先看一下" }])],
      [message("m1", [{ type: "thinking", text: "先看一下" }, tool])],
      [message("m1", [tool])],
      [{ type: "tool-result", toolUseId: "tool-1", content: "bin", isError: false }],
      [{ type: "tool-result", toolUseId: "tool-1", content: "bin", isError: false }],
      [message("m2", [{ type: "text", text: "读完了" }])],
      [completed],
    )

    expect(types(state)).toEqual([
      "run.started",
      "reasoning.completed",
      "tool.started",
      "tool.completed",
      "message.completed",
      "run.completed",
    ])
  })

  it("skips empty text and thinking", () => {
    const state = feed(
      sent(),
      [started],
      [
        message("m1", [
          { type: "text", text: "" },
          { type: "thinking", text: "" },
        ]),
      ],
    )
    expect(types(state)).toEqual(["run.started"])
  })

  it("shows a tool result without a tool call as its own tool", () => {
    const state = feed(
      sent(),
      [started],
      [{ type: "tool-result", toolUseId: "tool-9", content: "孤立", isError: true }],
    )
    const events = project(state).events

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.started",
      "tool.completed",
    ])
    expect(events[1]?.payload).toMatchObject({ toolCallId: "tool-9", name: "工具结果" })
    expect(events[2]?.payload).toMatchObject({ output: "孤立", isError: true })
  })

  it("maps Task and Agent tools to subagent events", () => {
    const state = feed(
      sent(),
      [started],
      [
        message("m1", [
          {
            type: "tool-use",
            id: "task-1",
            name: "Task",
            input: { subagent_type: "explore", description: "找文件", prompt: "搜索" },
          },
        ]),
      ],
      [message("m1", [{ type: "tool-use", id: "task-2", name: "Agent", input: {} }])],
      [{ type: "tool-result", toolUseId: "task-2", content: "失败", isError: true }],
    )
    const events = project(state).events

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "subagent.started",
      "subagent.started",
      "subagent.completed",
    ])
    expect(events[1]?.payload).toMatchObject({
      toolCallId: "task-1",
      name: "explore",
      description: "找文件",
      prompt: "搜索",
    })
    expect(events[2]?.payload).toMatchObject({ toolCallId: "task-2", name: "子代理" })
    expect(events[3]?.payload).toMatchObject({
      toolCallId: "task-2",
      output: "失败",
      isError: true,
      status: "failed",
    })
  })

  it("maps permission requests and how they were settled", () => {
    let state = feed(
      sent(),
      [started],
      [
        {
          type: "permission",
          requestId: "req-1",
          toolName: "Bash",
          input: { command: "rm -rf build" },
          blockedPath: "/work/demo/build",
        },
        "2026-11-14T01:00:05.000Z",
      ],
      [
        {
          type: "permission",
          requestId: "req-1",
          toolName: "Bash",
          input: { command: "rm -rf build" },
        },
      ],
      [{ type: "permission", requestId: "req-2", toolName: "Write", input: {} }],
      [{ type: "permission", requestId: "req-3", toolName: "Read", input: {} }],
    )
    state = reduceSession(state, {
      type: "permission-answered",
      requestId: "req-1",
      decision: "allow",
      at: "2026-11-14T01:00:30.000Z",
    })
    state = reduceSession(state, {
      type: "permission-answered",
      requestId: "req-2",
      decision: "deny",
      at: t0,
    })
    const approvals = project(state).events.filter((event) => event.type.startsWith("approval."))

    expect(approvals.map((event) => event.type)).toEqual([
      "approval.requested",
      "approval.resolved",
      "approval.requested",
      "approval.resolved",
      "approval.requested",
    ])
    expect(approvals[0]?.payload).toMatchObject({
      id: "req-1",
      toolName: "Bash",
      title: "Bash",
      command: "rm -rf build",
      description: "/work/demo/build",
    })
    expect(approvals[1]?.payload).toEqual({ id: "req-1", decision: "allow-once" })
    expect(approvals.slice(0, 2).map((event) => event.createdAt)).toEqual([
      "2026-11-14T01:00:05.000Z",
      "2026-11-14T01:00:30.000Z",
    ])
    expect(approvals[3]?.payload).toEqual({ id: "req-2", decision: "deny" })
    expect(approvals[4]?.payload).not.toHaveProperty("decision")
  })

  it("settles unanswered permissions when the turn ends, as timeouts when it timed out", () => {
    const asked = feed(
      sent(),
      [started],
      [{ type: "permission", requestId: "req-1", toolName: "Bash", input: {} }],
    )
    const denied = feed(asked, [
      {
        type: "turn-ended",
        turnId: "main-1",
        status: "interrupted",
        errorCode: "SESSION_CANCELLED",
      },
      "2026-11-14T01:00:12.000Z",
    ])
    const timedOut = feed(asked, [
      { type: "turn-ended", turnId: "main-1", status: "error", errorCode: "PERMISSION_TIMEOUT" },
    ])

    const resolved = project(denied).events.find((event) => event.type === "approval.resolved")
    expect(resolved?.payload).toEqual({ id: "req-1", decision: "deny" })
    expect(resolved?.createdAt).toBe("2026-11-14T01:00:12.000Z")
    expect(project(timedOut).events.at(-2)?.payload).toEqual({ id: "req-1", decision: "deny" })
  })

  it("marks account switches inside a turn without a run id and skips the initial pick", () => {
    const state = feed(
      sent(),
      [{ type: "account-switched", from: null, to: "a", reason: "initial" }],
      [started],
      [{ type: "account-switched", from: "a", to: "b", reason: "quota" }],
      [{ type: "account-switched", from: "a", to: "b", reason: "quota" }],
      [completed],
      [{ type: "account-switched", from: "b", to: "c", reason: "switch" }],
    )
    const updates = project(state).events.filter((event) => event.type === "thread.updated")

    expect(updates).toHaveLength(1)
    expect(updates[0]?.runId).toBeNull()
    expect(updates[0]?.payload).toEqual({ agentId: "b" })
  })

  it("ends a stopped turn as interrupted at its end time and a failed one with its last error", () => {
    const stopped = reduceSession(feed(sent(), [started]), {
      type: "cancel-requested",
      at: "2026-11-14T01:00:12.000Z",
    })
    const failed = feed(
      sent(),
      [started],
      [{ type: "error", code: "SDK_ERROR", message: "先出现的错误" }],
      [{ type: "error", code: "NEW_CODE", message: "最后的错误" }],
    )

    expect(types(stopped)).toEqual(["run.started", "run.interrupted"])
    expect(project(stopped).events[1]?.createdAt).toBe("2026-11-14T01:00:12.000Z")
    expect(types(failed)).toEqual(["run.started", "run.failed"])
    expect(project(failed).events[1]?.payload).toEqual({ message: "最后的错误" })
  })

  it("numbers runs per turn and reports the last one", () => {
    let state = feed(sent("一"), [started], [completed])
    state = reduceSession(state, { type: "user-message", text: "二", turnId: "turn-2", at: t0 })
    state = feed(state, [{ type: "turn-started", turnId: "main-2" }])
    const { events, lastRunId } = project(state)

    expect([...new Set(events.map((event) => event.runId))]).toEqual(["run-1", "run-2"])
    expect(events.filter((event) => event.type === "run.started").map((e) => e.payload)).toEqual([
      { agentId: "claude", text: "一" },
      { agentId: "claude", text: "二" },
    ])
    expect(lastRunId).toBe("run-2")
  })
})
