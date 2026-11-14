// 负责验证会话状态到 Pigcode 线程模型的纯函数映射：线程元数据、时间线事件和流式文字取自信封的投影，
// 线程的创建和更新时间、最后一轮的 run id。事件内容的逐条映射见 session-timeline 的测试。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { projectTimeline } from "./session-timeline"
import { threadView, type ThreadViewInput } from "./thread-view"

const t0 = "2026-11-14T01:00:00.000Z"

/** 构造会话状态：会话已打开，账号和模型已知，还没有轮次。 */
function state(): SessionUiState {
  const opened = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  return { ...opened, model: "sonnet", accountId: "account-1" }
}

/** 构造映射输入；测试只覆盖关心的字段。 */
function input(overrides: Partial<ThreadViewInput> = {}): ThreadViewInput {
  return {
    state: state(),
    threadId: "thread-1",
    workspace: "/work/demo",
    projectName: "demo",
    instanceId: "account-1",
    modelId: "sonnet",
    permissionLevel: "approval-required",
    planMode: false,
    startedAt: Date.UTC(2026, 10, 13, 0, 0, 0),
    ...overrides,
  }
}

function feed(from: SessionUiState, ...items: Array<[SessionHostEvent, string]>): SessionUiState {
  return items.reduce((current, [event, at]) => receive(current, event, at), from)
}

describe("threadView", () => {
  it("空会话只产出线程元数据，没有事件", () => {
    const view = threadView(input())
    expect(view.events).toEqual([])
    expect(view).toMatchObject({ streamingText: "", liveReasoning: "" })
    expect(view.thread).toMatchObject({
      id: "thread-1",
      projectId: "/work/demo",
      title: "demo",
      defaultInstanceId: "account-1",
      lastInstanceId: "account-1",
      lastModelId: "sonnet",
      permissionMode: "approval-required",
      planMode: false,
      lastRunId: null,
      parentThreadId: null,
      archivedAt: null,
    })
    expect(view.thread.createdAt).toBe(new Date(Date.UTC(2026, 10, 13, 0, 0, 0)).toISOString())
    expect(view.thread.updatedAt).toBe(view.thread.createdAt)
  })

  it("时间线取信封投影，线程时间取第一轮的开始和最后一条事件", () => {
    const sent = reduceSession(state(), {
      type: "user-message",
      text: "你好",
      turnId: "turn-1",
      at: t0,
    })
    const session = feed(
      sent,
      [{ type: "turn-started", turnId: "main-1" }, "2026-11-14T01:00:00.200Z"],
      [
        {
          type: "message",
          messageId: "m1",
          model: "claude-sonnet",
          subagent: null,
          blocks: [{ type: "text", text: "答" }],
        },
        "2026-11-14T01:00:09.000Z",
      ],
      [
        { type: "turn-ended", turnId: "main-1", status: "completed", errorCode: null },
        "2026-11-14T01:01:02.000Z",
      ],
    )
    const view = threadView(input({ state: session }))

    expect(view.events).toEqual(
      projectTimeline({
        threadId: "thread-1",
        record: sessionRecord(session.events, "session-1"),
        turns: session.turns,
        answers: session.answers,
      }).events,
    )
    expect(view.events.map((event) => event.type)).toEqual([
      "run.started",
      "message.completed",
      "run.completed",
    ])
    expect(view.thread.lastRunId).toBe("run-1")
    expect(view.thread.createdAt).toBe(t0)
    expect(view.thread.updatedAt).toBe("2026-11-14T01:01:02.000Z")
  })

  it("进行中的一轮把正在输出的正文和思考交给聊天视图", () => {
    const sent = reduceSession(state(), {
      type: "user-message",
      text: "你好",
      turnId: "turn-1",
      at: t0,
    })
    const session = feed(
      sent,
      [{ type: "turn-started", turnId: "main-1" }, t0],
      [{ type: "delta", text: "想", thinking: true, blockIndex: 0 }, t0],
      [{ type: "delta", text: "答到一半", thinking: false, blockIndex: 1 }, t0],
    )
    const view = threadView(input({ state: session }))

    expect(view).toMatchObject({ streamingText: "答到一半", liveReasoning: "想" })
    expect(view.events.map((event) => event.type)).toEqual(["run.started"])
  })

  it("没有工作区、项目名或模型时使用稳定回退值", () => {
    const view = threadView(input({ workspace: null, projectName: "", modelId: "" }))
    expect(view.thread.projectId).toBe("workspace")
    expect(view.thread.title).toBe("会话")
    expect(view.thread.lastModelId).toBeNull()
  })

  it("线程带上输入框的档位和独立的计划开关", () => {
    expect(
      threadView(input({ permissionLevel: "full-access", planMode: true })).thread,
    ).toMatchObject({ permissionMode: "full-access", planMode: true })
    expect(
      threadView(input({ permissionLevel: "auto-accept-edits", planMode: false })).thread,
    ).toMatchObject({ permissionMode: "auto-accept-edits", planMode: false })
  })
})
