// 负责验证聊天页的提问卡：Claude 用 AskUserQuestion 提问时，卡片显示在这一轮里、权限卡片的位置之外，
// 单选和多选的答案交给会话控制器；主进程结束这次提问后卡片换成「已询问」的历史行，
// 没有回答时显示未回答；计划模式下的提问用同一张卡片。

// @vitest-environment jsdom
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import type { SessionHostEvent } from "../../../main/session/session-types"
import type { SessionUiState } from "../models/session-model"
import {
  buttonNamed,
  chatScreenRoot,
  clickButton,
  sessionController as controller,
  sessionTime,
  startingState,
} from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const screen = chatScreenRoot()

const questions = [
  {
    question: "Which color should the label use?",
    header: "Color",
    options: [{ label: "Blue", description: "Matches the theme" }, { label: "Green" }],
    multiSelect: false,
  },
  {
    question: "Which platforms should it cover?",
    options: [{ label: "macOS" }, { label: "Windows" }, { label: "Linux" }],
    multiSelect: true,
  },
]

const asking: SessionHostEvent[] = [
  { type: "turn-started", turnId: "main-turn-1" },
  {
    type: "message",
    messageId: "m-1",
    model: "claude-sonnet",
    subagent: null,
    blocks: [{ type: "tool-use", id: "tool-ask", name: "AskUserQuestion", input: { questions } }],
  },
  { type: "question", requestId: "q-1", questions },
]

function feed(state: SessionUiState, ...events: SessionHostEvent[]): SessionUiState {
  return events.reduce((current, event) => receive(current, event, sessionTime), state)
}

function card(): HTMLFormElement | null {
  return screen.container.querySelector<HTMLFormElement>("form.question-card")
}

async function choose(label: string): Promise<void> {
  const input = [...(card()?.querySelectorAll<HTMLInputElement>("label.question-option") ?? [])]
    .find((option) => option.textContent?.startsWith(label))
    ?.querySelector("input")
  expect(input, label).not.toBeNull()
  await act(async () => {
    await userEvent.click(input!)
  })
}

describe("chat screen questions", () => {
  it("shows the question card in the turn and sends the chosen answers", async () => {
    const session = controller({ state: feed(startingState(), ...asking) })
    await screen.render({ fresh: false, session })

    const form = card()
    expect(form, "提问卡").not.toBeNull()
    expect(form?.closest("section.turn")).not.toBeNull()
    expect(form?.textContent).toContain("Which color should the label use?")
    expect(screen.container.querySelector(".work-head")?.textContent).toContain("等待回答")
    expect([...document.querySelectorAll(".perm")]).toEqual([form])

    await choose("Blue")
    await choose("macOS")
    await choose("Linux")
    await clickButton(buttonNamed("提交回答", form ?? document), "提交回答")

    expect(session.answerQuestion).toHaveBeenCalledWith("q-1", ["Blue", "macOS, Linux"])
  })

  it("replaces the card with the asked row once the main process ends the question", async () => {
    const state = feed(startingState(), ...asking, {
      type: "question-resolved",
      requestId: "q-1",
      answers: ["Blue", "macOS, Linux"],
    })
    await screen.render({ fresh: false, session: controller({ state }) })

    expect(card()).toBeNull()
    const rows = [...screen.container.querySelectorAll(".turn-work .tool-row")].map(
      (row) => row.textContent ?? "",
    )
    expect(rows).toEqual(["已询问2 个问题"])
  })

  it("shows an unanswered question as not answered after the turn is stopped", async () => {
    const state = feed(
      startingState(),
      ...asking,
      { type: "question-resolved", requestId: "q-1", answers: [] },
      { type: "turn-ended", turnId: "main-turn-1", status: "interrupted", errorCode: null },
    )
    await screen.render({ fresh: false, session: controller({ state }) })

    expect(card()).toBeNull()
    expect(screen.container.textContent).toContain("未提供回答")
  })

  it("answers on the same card in plan mode", async () => {
    const plan = receive(startingState(), { type: "mode", permissionMode: "plan" }, sessionTime)
    const session = controller({ state: feed(plan, ...asking) })
    await screen.render({ fresh: false, session })

    await choose("Green")
    await choose("Windows")
    await clickButton(buttonNamed("提交回答", card() ?? document), "提交回答")

    expect(session.answerQuestion).toHaveBeenCalledWith("q-1", ["Green", "Windows"])
    expect(session.respondPermission).not.toHaveBeenCalled()
  })
})
