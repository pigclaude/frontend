// 用真实输入框核对历史会话搜索、归档标记、发送和回放。
// @vitest-environment jsdom

import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { resetComposerMemory } from "@pigclaude/ui-composer"
import { beforeEach, expect, it, vi } from "vitest"
import type { SessionBridge } from "../../main/session/session-types"
import { DesktopApp } from "./app"
import type { SavedSessionSummary } from "./models/saved-session"
import { clickButton } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"

const app = desktopAppRoot()
beforeEach(resetComposerMemory)

const archived: SavedSessionSummary = {
  sessionId: "archived-id",
  workspace: "/work/web",
  projectPath: "/work/web",
  title: "历史重试方案",
  archivedAt: "2026-11-12T09:00:00.000Z",
  restorable: true,
  status: "parked",
  lastTurn: "completed",
  turnId: null,
  pendingPermissions: 0,
  pendingQuestions: 0,
  accountId: null,
  model: "claude-sonnet",
  lastActivityAt: "2026-11-11T09:00:00.000Z",
}

it("searches archived sessions from a project draft and sends a replayable reference", async () => {
  installFakeDesktopBridge()
  const send = vi.fn<SessionBridge["send"]>(async () => undefined)
  const fixture = fakeSessionBridge({
    list: async (input) => (input?.archived ? [archived] : []),
    start: async ({ sessionId }) => ({ sessionId: sessionId ?? "new-id" }),
    rename: async () => undefined,
    archive: async () => undefined,
    send,
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = fixture.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  const editor = app.container.querySelector<HTMLElement>(".new-thread-view .tiptap")
  if (!editor) throw new Error("新会话输入框尚未加载")
  await act(async () => userEvent.type(editor, "参考 @历史重试"))

  await vi.waitFor(() => {
    const option = document.querySelector<HTMLElement>('[role="option"]')
    expect(option?.textContent ?? "").toContain("历史重试方案")
    expect(option?.textContent ?? "").toContain("已归档")
  })
  await act(async () => userEvent.keyboard("{Enter}"))
  expect(editor.querySelector('.mention-chip[data-kind="thread"]')?.textContent).toBe(
    "@历史重试方案",
  )
  await clickButton(
    app.container.querySelector<HTMLElement>('button[aria-label="发送"]') ?? undefined,
    "发送",
  )
  const sent = send.mock.calls[0]?.[0]
  const references = [{ kind: "thread", threadId: archived.sessionId, title: archived.title }]
  expect(sent).toMatchObject({ text: "参考 @历史重试方案", references })
  if (!sent) throw new Error("消息尚未发送")
  await act(async () =>
    fixture.push({
      version: 1,
      sessionId: sent.sessionId,
      seq: 1,
      at: "2026-11-15T09:00:00.000Z",
      event: {
        type: "turn-started",
        turnId: "echo",
        userText: sent.text,
        ...(sent.references ? { references: sent.references } : {}),
      },
    }),
  )
  expect(app.container.querySelector(".msg-user .mention-thread")?.textContent).toBe("历史重试方案")
})
