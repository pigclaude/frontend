// 负责验证提问在时间线上的投影：提问成为这一轮里的提问事件，结束事件带上每个问题的答案，
// 没有回答时答案为空；提问之前的正文不当作这一轮的回答。

import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { receive } from "../test-support/session-envelopes"
import { sessionRecord } from "./session-event-store"
import { createSessionState, reduceSession, type SessionUiState } from "./session-model"
import { projectTimeline } from "./session-timeline"

const t0 = "2026-11-14T01:00:00.000Z"
const asked = "2026-11-14T01:00:03.000Z"
const answered = "2026-11-14T01:00:20.000Z"

const questions = [
  {
    question: "Which color should the label use?",
    header: "Color",
    options: [{ label: "Blue", description: "Matches the theme" }, { label: "Green" }],
    multiSelect: false,
  },
]

function sent(): SessionUiState {
  const state = reduceSession(createSessionState(), { type: "opened", sessionId: "session-1" })
  return reduceSession(state, { type: "user-message", text: "挑个颜色", turnId: "turn-1", at: t0 })
}

function feed(state: SessionUiState, ...items: Array<[SessionHostEvent, string?]>): SessionUiState {
  return items.reduce((current, [event, at]) => receive(current, event, at ?? t0), state)
}

function project(state: SessionUiState) {
  return projectTimeline({
    threadId: "thread-1",
    record: sessionRecord(state.events, state.sessionId),
    turns: state.turns,
    answers: state.answers,
  }).events.map(({ type, payload, createdAt, runId }) => ({ type, payload, createdAt, runId }))
}

describe("projectTimeline questions", () => {
  it("puts the question and its answers in the turn at the times the main process recorded", () => {
    const state = feed(
      sent(),
      [{ type: "turn-started", turnId: "main-1" }],
      [{ type: "question", requestId: "q-1", questions }, asked],
      [{ type: "question-resolved", requestId: "q-1", answers: ["Blue"] }, answered],
    )

    expect(project(state).slice(1)).toEqual([
      {
        type: "question.requested",
        payload: { id: "q-1", questions },
        createdAt: asked,
        runId: "run-1",
      },
      {
        type: "question.answered",
        payload: { id: "q-1", answers: ["Blue"] },
        createdAt: answered,
        runId: "run-1",
      },
    ])
  })

  it("leaves an open question without an answer event and records an unanswered one as empty", () => {
    const open = feed(
      sent(),
      [{ type: "turn-started", turnId: "main-1" }],
      [{ type: "question", requestId: "q-1", questions }, asked],
    )
    expect(project(open).map((event) => event.type)).toEqual(["run.started", "question.requested"])

    const declined = feed(open, [
      { type: "question-resolved", requestId: "q-1", answers: [] },
      answered,
    ])
    expect(project(declined).at(-1)).toMatchObject({
      type: "question.answered",
      payload: { id: "q-1", answers: [] },
    })
  })

  it("fails the turn with a question timeout message when nobody answers in time", () => {
    const state = feed(
      sent(),
      [{ type: "turn-started", turnId: "main-1" }],
      [{ type: "question", requestId: "q-1", questions }, asked],
      [{ type: "question-resolved", requestId: "q-1", answers: [] }, answered],
      [{ type: "error", code: "QUESTION_TIMEOUT", message: "提问超时" }, answered],
      [{ type: "turn-ended", turnId: "main-1", status: "error", errorCode: "QUESTION_TIMEOUT" }],
    )

    expect(project(state).at(-1)).toMatchObject({
      type: "run.failed",
      payload: { message: "提问超时，已拒绝" },
    })
  })
})
