// 负责验证聊天页的流式回答和思考耗时：正在写的正文带光标显示在回答的位置，写完到一轮结束前不挪位置，
// 结束后落成普通回答；点停止后正文留在原位，主进程补发的消息落在同一处；思考块显示主进程算好的耗时，正在输出的思考显示为正在思考。

// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import { reduceSession, type SessionUiState } from "../models/session-model"
import {
  chatScreenRoot,
  sessionController as controller,
  sessionTime,
  startingState,
} from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const screen = chatScreenRoot()

const started: SessionHostEvent = { type: "turn-started", turnId: "main-turn-1" }

function feed(state: SessionUiState, ...events: SessionHostEvent[]): SessionUiState {
  return events.reduce((current, event) => receive(current, event, sessionTime), state)
}

function message(block: { type: "text" | "thinking"; text: string }, thinkingMs?: number) {
  return {
    type: "message",
    messageId: `m-${block.type}`,
    model: "claude-sonnet",
    parentToolUseId: null,
    blocks: [block],
    ...(thinkingMs === undefined ? {} : { thinkingMs }),
  } satisfies SessionHostEvent
}

function answers(): Array<{ text: string; streaming: boolean; busy: string | null }> {
  return [...screen.container.querySelectorAll<HTMLElement>(".msg-ai")].map((element) => ({
    text: element.textContent ?? "",
    streaming: element.classList.contains("is-streaming"),
    busy: element.getAttribute("aria-busy"),
  }))
}

async function show(state: SessionUiState): Promise<void> {
  await screen.render({ fresh: false, session: controller({ state }) })
}

describe("chat screen streaming", () => {
  it("writes the reply in the answer with a cursor and keeps it there until the turn ends", async () => {
    const writing = feed(startingState(), started, {
      type: "delta",
      text: "先看",
      thinking: false,
      blockIndex: 0,
    })
    await show(writing)
    expect(answers()).toEqual([{ text: "先看", streaming: true, busy: "true" }])

    const written = feed(writing, message({ type: "text", text: "先看一下重试条件" }))
    await show(written)
    expect(answers()).toEqual([{ text: "先看一下重试条件", streaming: true, busy: "true" }])

    await show(
      feed(written, {
        type: "turn-ended",
        turnId: "main-turn-1",
        status: "completed",
        errorCode: null,
      }),
    )
    expect(answers()).toEqual([{ text: "先看一下重试条件", streaming: false, busy: null }])
  })

  it("keeps the reply in place after a stop and lands the main process's copy there", async () => {
    const writing = feed(startingState(), started, {
      type: "delta",
      text: "先看一下重试",
      thinking: false,
      blockIndex: 0,
    })
    const stopped = reduceSession(writing, { type: "cancel-requested", at: sessionTime })
    await show(stopped)
    expect(answers()).toEqual([{ text: "先看一下重试", streaming: false, busy: null }])

    await show(
      feed(
        stopped,
        { ...message({ type: "text", text: "先看一下重试" }), messageId: "unfinished-main-turn-1" },
        {
          type: "turn-ended",
          turnId: "main-turn-1",
          status: "interrupted",
          errorCode: "SESSION_CANCELLED",
        },
      ),
    )
    expect(answers()).toEqual([{ text: "先看一下重试", streaming: false, busy: null }])
  })

  it("shows how long thinking took as the main process timed it", async () => {
    await show(feed(startingState(), started, message({ type: "thinking", text: "先想想" }, 4_200)))
    expect(screen.container.textContent).toContain("持续了 5 秒")
  })

  it("falls back to a few seconds when the main process did not time the thinking", async () => {
    await show(feed(startingState(), started, message({ type: "thinking", text: "先想想" })))

    expect(screen.container.textContent).toContain("持续了几秒")
  })

  it("shows thinking that is still being written as thinking in progress", async () => {
    await show(
      feed(startingState(), started, {
        type: "delta",
        text: "先想想重试条件",
        thinking: true,
        blockIndex: 0,
      }),
    )

    expect(screen.container.textContent).toContain("正在思考")
    expect(screen.container.textContent).not.toContain("持续了")
  })
})
