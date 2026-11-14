// 通过聊天页的输入框、发送入口和历史信封验证会话引用。
// @vitest-environment jsdom
import { act } from "react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { requestComposerContext, requestComposerThreadMention } from "@pigclaude/ui-composer"
import type { SessionReference } from "../../../main/session/session-types"
import { createSessionState, reduceSession } from "../models/session-model"
import { chatScreenRoot, clickButton, sessionController } from "../test-support/chat-screen-harness"
import { receive } from "../test-support/session-envelopes"

const view = chatScreenRoot()
const reference: SessionReference = { kind: "thread", threadId: "source-id", title: "参考会话" }

function send() {
  return clickButton(
    view.container.querySelector<HTMLButtonElement>('button[aria-label="发送"]') ?? undefined,
    "发送",
  )
}

it("restores the draft reference and attachment after startup fails, then sends both", async () => {
  const start = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const session = sessionController({ start })
  await view.render({ session })
  await act(async () => {
    requestComposerThreadMention(reference.threadId, reference.title)
    requestComposerContext({ id: "attachment", label: "项目附件", markdown: "附件正文" })
  })
  await send()

  expect(session.send).not.toHaveBeenCalled()
  expect(view.container.querySelector(".tiptap .mention-chip")?.textContent).toBe("@参考会话")
  expect(view.container.querySelector(".composer-context")?.textContent).toBe("项目附件")

  await send()

  expect(session.send).toHaveBeenCalledExactlyOnceWith("@参考会话\n\n附件正文", {
    effort: null,
    fast: false,
    references: [reference],
  })
})

it("renders the stored reference label and resumes with references and the saved settings", async () => {
  const sessionId = "parked-id"
  let state = reduceSession(createSessionState(), { type: "opened", sessionId })
  state = receive(state, {
    type: "turn-started",
    turnId: "stored-turn",
    userText: "继续 @参考会话 的工作",
    references: [reference],
  })
  state = receive(state, {
    type: "turn-ended",
    turnId: "stored-turn",
    status: "completed",
    errorCode: null,
  })
  state = receive(state, { type: "ended", reason: "stopped" })
  const session = sessionController({ state })
  await view.render({
    fresh: false,
    identifySessions: true,
    session,
    summary: {
      sessionId,
      workspace: "/Users/me/app",
      model: "claude-sonnet",
      status: "parked",
      lastTurn: "completed",
      turnId: null,
      pendingPermissions: 0,
      pendingQuestions: 0,
      accountId: null,
      lastActivityAt: "2026-11-14T01:00:00.000Z",
      restorable: true,
    },
  })

  expect(view.container.querySelector(".msg-user .mention-thread")?.textContent).toBe("参考会话")
  await act(async () => requestComposerThreadMention(reference.threadId, reference.title))
  await send()

  expect(session.start).not.toHaveBeenCalled()
  expect(session.send).toHaveBeenCalledExactlyOnceWith(
    "@参考会话",
    { references: [reference] },
    expect.objectContaining({ sessionId }),
    expect.any(Function),
  )
})

it("sends a slash command without structured references", async () => {
  const session = sessionController()
  await view.render({ session })
  const editor = view.container.querySelector<HTMLElement>(".tiptap")
  if (!editor) throw new Error("草稿缺少输入框")
  await act(async () => {
    await userEvent.setup().type(editor, "/compact ")
    requestComposerThreadMention(reference.threadId, reference.title)
  })
  expect(editor.querySelector(".mention-chip")).not.toBeNull()

  await send()

  expect(session.send).toHaveBeenCalledExactlyOnceWith("/compact @参考会话", {
    effort: null,
    fast: false,
  })
})
