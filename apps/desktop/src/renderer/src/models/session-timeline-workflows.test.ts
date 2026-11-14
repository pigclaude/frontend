// 负责验证投影里的工作流：每份工作流快照成为这一轮里的一条工作流更新，事件时间取信封时间；
// 主线程的 Workflow 工具调用和它的工具结果不再画成工具行，由工作流卡代替。

import type { WorkflowSnapshot } from "@pigclaude/ui-contracts"
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { projectTimeline, type SessionTimeline } from "./session-timeline"

const t0 = "2026-11-14T01:00:00.000Z"
const call = "call-workflow"

function sent(): SessionUiState {
  const state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  return reduceSession(state, { type: "user-message", text: "跑个工作流", turnId: "t-1", at: t0 })
}

function feed(state: SessionUiState, ...events: SessionHostEvent[]): SessionUiState {
  return events.reduce((current, event, index) => {
    const at = new Date(Date.parse(t0) + (index + 1) * 1_000).toISOString()
    return receive(current, event, at)
  }, state)
}

function project(state: SessionUiState): SessionTimeline {
  return projectTimeline({
    threadId: "thread-1",
    record: sessionRecord(state.events, state.sessionId),
    turns: state.turns,
    answers: state.answers,
  })
}

function snapshot(status: WorkflowSnapshot["status"], states: string[]): SessionHostEvent {
  return {
    type: "workflow",
    workflow: {
      toolCallId: call,
      name: "review",
      status,
      phases: [{ index: 1, title: "Review" }],
      agents: states.map((state, index) => ({
        index: index + 1,
        label: `review:${index + 1}`,
        phase: "Review",
        state: state as WorkflowSnapshot["agents"][number]["state"],
      })),
    },
  }
}

const working: SessionHostEvent[] = [
  { type: "turn-started", turnId: "main-1" },
  {
    type: "message",
    messageId: "m1",
    model: "claude-sonnet",
    subagent: null,
    blocks: [
      { type: "tool-use", id: call, name: "Workflow", input: { script: "phase('Review')" } },
    ],
  },
  snapshot("running", []),
  {
    type: "tool-result",
    toolUseId: call,
    content: "Workflow launched in background",
    isError: false,
    subagent: null,
    backgroundLaunch: true,
  },
  snapshot("running", ["running", "queued"]),
]

describe("projectTimeline workflows", () => {
  it("projects each workflow snapshot as a workflow update in its turn at its envelope time", () => {
    const timeline = project(feed(sent(), ...working, snapshot("completed", ["done", "done"])))

    const updates = timeline.events.filter((event) => event.type === "workflow.updated")
    expect(updates.map((event) => (event.payload as WorkflowSnapshot).status)).toEqual([
      "running",
      "running",
      "completed",
    ])
    expect(updates.map((event) => event.createdAt)).toEqual([
      "2026-11-14T01:00:03.000Z",
      "2026-11-14T01:00:05.000Z",
      "2026-11-14T01:00:06.000Z",
    ])
    expect(new Set(updates.map((event) => event.runId))).toEqual(new Set(["run-1"]))
    expect(updates[1]?.payload).toMatchObject({
      agents: [
        { label: "review:1", state: "running" },
        { label: "review:2", state: "queued" },
      ],
    })
  })

  it("draws the Workflow tool call as the workflow card instead of a tool row", () => {
    const timeline = project(feed(sent(), ...working))

    const tools = timeline.events.filter(
      (event) => event.type === "tool.started" || event.type === "tool.completed",
    )
    expect(tools).toEqual([])
  })
})
