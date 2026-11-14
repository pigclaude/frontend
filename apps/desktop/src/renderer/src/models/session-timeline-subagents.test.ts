// 负责验证投影里的子代理：子代理的消息、思考和工具调用带上父工具调用 id，只进它的子代理卡；
// 卡片在子代理结束事件到达时才完成，后台启动的工具结果不算完成；一轮结束时还没等到结束事件的卡，
// 前台子代理按交回的结果完成，后台子代理没有结果、按中断收尾。

import { collectSubagents } from "@pigclaude/ui-chat"
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { projectTimeline, type SessionTimeline } from "./session-timeline"

const t0 = "2026-11-14T01:00:00.000Z"
const call = "call-agent"
const started: SessionHostEvent = { type: "turn-started", turnId: "main-1" }

function sent(): SessionUiState {
  const state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  return reduceSession(state, {
    type: "user-message",
    text: "派个子代理",
    turnId: "turn-1",
    at: t0,
  })
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

function message(
  messageId: string,
  blocks: Extract<SessionHostEvent, { type: "message" }>["blocks"],
  parentToolUseId: string | null = null,
): SessionHostEvent {
  return {
    type: "message",
    messageId,
    model: "claude-sonnet",
    subagent: parentToolUseId === null ? null : { parentToolUseId, agentId: "agent-1" },
    blocks,
  }
}

const spawn = message("m1", [
  {
    type: "tool-use",
    id: call,
    name: "Agent",
    input: { subagent_type: "general-purpose", description: "跑命令", prompt: "运行 sleep" },
  },
])
const launched: SessionHostEvent = {
  type: "tool-result",
  toolUseId: call,
  content: "Async agent launched successfully.",
  isError: false,
  subagent: null,
  backgroundLaunch: true,
}

function ending(status: "completed" | "interrupted"): SessionHostEvent {
  return {
    type: "turn-ended",
    turnId: "main-1",
    status,
    errorCode: status === "completed" ? null : "SESSION_CANCELLED",
  }
}
const subagentWork: SessionHostEvent[] = [
  message("s1", [{ type: "thinking", text: "先跑命令" }], call),
  message(
    "s1",
    [{ type: "tool-use", id: "bash-1", name: "Bash", input: { command: "sleep 21" } }],
    call,
  ),
  {
    type: "tool-result",
    toolUseId: "bash-1",
    content: "SUB_DONE",
    isError: false,
    subagent: { parentToolUseId: call, agentId: "agent-1" },
  },
  message("s2", [{ type: "text", text: "命令输出 SUB_DONE" }], call),
]

function ended(status: "completed" | "failed" | "stopped"): SessionHostEvent {
  return {
    type: "subagent-ended",
    parentToolUseId: call,
    agentId: "agent-1",
    status,
    summary: "输出 SUB_DONE",
  }
}

describe("projectTimeline subagents", () => {
  it("scopes the subagent's thinking, text and tools to its card", () => {
    const timeline = project(feed(sent(), started, spawn, launched, ...subagentWork))
    const scoped = timeline.events.filter(
      (event) => (event.payload as Record<string, unknown>).parentToolUseId === call,
    )

    expect(scoped.map((event) => event.type)).toEqual([
      "reasoning.completed",
      "tool.started",
      "tool.completed",
      "message.completed",
    ])
    const card = collectSubagents(timeline.events).get(call)
    expect(card?.events.map((event) => event.type)).toEqual(scoped.map((event) => event.type))
    expect(card).toMatchObject({
      name: "general-purpose",
      description: "跑命令",
      prompt: "运行 sleep",
    })
  })

  it("keeps a background subagent running after its launch result until it ends", () => {
    const running = project(feed(sent(), started, spawn, launched, ...subagentWork))
    const done = project(
      feed(sent(), started, spawn, launched, ...subagentWork, ended("completed")),
    )

    expect(collectSubagents(running.events).get(call)?.status).toBe("running")
    expect(collectSubagents(done.events).get(call)).toMatchObject({
      status: "completed",
      output: "输出 SUB_DONE",
    })
  })

  it("shows a stopped subagent as interrupted and a failed one as failed", () => {
    const stopped = project(feed(sent(), started, spawn, launched, ended("stopped")))
    const failed = project(feed(sent(), started, spawn, launched, ended("failed")))

    expect(collectSubagents(stopped.events).get(call)?.status).toBe("interrupted")
    expect(collectSubagents(failed.events).get(call)?.status).toBe("failed")
  })

  it("leaves a background subagent with no end event by the end of its turn without a result, as interrupted", () => {
    const finished = feed(sent(), started, spawn, launched, ...subagentWork, ending("completed"))
    const stopped = feed(sent(), started, spawn, launched, ending("interrupted"))

    for (const state of [finished, stopped]) {
      const card = collectSubagents(project(state).events).get(call)
      expect(card?.status).toBe("interrupted")
      expect(card?.output).toBeUndefined()
    }
  })

  it("completes a foreground subagent with no end event with its hand-back result", () => {
    const handBack: SessionHostEvent = {
      type: "tool-result",
      toolUseId: call,
      content: "交回的结果",
      isError: false,
      subagent: null,
    }
    const finished = feed(sent(), started, spawn, ...subagentWork, handBack, ending("completed"))

    expect(collectSubagents(project(finished).events).get(call)).toMatchObject({
      status: "completed",
      output: "交回的结果",
    })
  })

  it("keeps the main answer in the streaming place while the subagent works", () => {
    const answer = message("m2", [{ type: "text", text: "已在后台启动" }])
    const timeline = project(feed(sent(), started, spawn, launched, answer, ...subagentWork))

    expect(timeline.streamingText).toBe("已在后台启动")
  })
})
