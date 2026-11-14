// 验证重开已保存的会话只读时间线，第一条新消息续接原 id，失败时保留记录和草稿。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { expect, it, vi } from "vitest"
import type { SessionBridge, SessionHostEvent } from "../../main/session/session-types"
import type { SessionEnvelope } from "../../main/session/session-envelope"
import type { SessionSummary } from "../../main/session/session-summary"
import { DesktopApp } from "./app"
import { clickButton, typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"

const app = desktopAppRoot()
const savedId = "saved-id"
const at = "2026-10-01T01:02:03.000Z"
const saved: SessionSummary & { title: string; projectPath: string; restorable: boolean } = {
  sessionId: savedId,
  workspace: "/work/api-worktree",
  projectPath: "/work/api",
  title: "磁盘保存的会话",
  restorable: true,
  status: "parked",
  lastTurn: "completed",
  turnId: null,
  pendingPermissions: 0,
  pendingQuestions: 0,
  accountId: null,
  model: "claude-sonnet",
  lastActivityAt: at,
}

function recorded(seq: number, event: SessionHostEvent): SessionEnvelope {
  return { version: 1, sessionId: savedId, seq, at, event }
}

const sent = { type: "turn-started", turnId: "saved-turn", userText: "原消息" } as const
const timeline = [
  recorded(1, sent),
  recorded(2, {
    type: "permission",
    requestId: "old-permission",
    toolName: "Read",
    input: { file_path: "README.md" },
    subagent: null,
  }),
  recorded(3, {
    type: "message",
    messageId: "saved-reply",
    model: "claude-sonnet",
    subagent: null,
    blocks: [{ type: "text", text: "磁盘上的原回复" }],
  }),
  recorded(4, {
    type: "question",
    requestId: "old-question",
    questions: [
      {
        question: "旧问题",
        header: "旧问题",
        options: [{ label: "是" }, { label: "否" }],
        multiSelect: false,
      },
    ],
  }),
  recorded(6, { type: "turn-ended", turnId: "saved-turn", status: "completed", errorCode: null }),
  recorded(7, { type: "ended", reason: "stopped" }),
]

async function openSaved(send: SessionBridge["send"]): Promise<SessionBridge> {
  installFakeDesktopBridge()
  const session = fakeSessionBridge({
    list: async () => [saved],
    events: async ({ sessionId, afterSeq }) =>
      sessionId === savedId
        ? timeline.filter((event) => (event.seq ?? 0) > afterSeq).reverse()
        : [],
    send,
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  const project = [...app.container.querySelectorAll("button.proj")].find(
    (row) => row.textContent?.trim() === "api",
  )
  const row = project?.closest(".proj-block")?.querySelector<HTMLButtonElement>(".sess")
  expect(row?.textContent).toContain("磁盘保存的会话")
  await clickButton(row ?? undefined, "保存的会话")
  await flush()
  return session.bridge
}

it("opens saved messages and sends the first new message to the existing session", async () => {
  const send = vi.fn(async () => undefined)
  const bridge = await openSaved(send)
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("原消息")
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("磁盘上的原回复")
  expect(app.container.querySelector(".chat-page time")?.getAttribute("datetime")).toBe(at)
  expect(app.container.querySelector(".perm.question-card")).toBeNull()
  expect(app.container.querySelector(".perm-dock .perm")).toBeNull()
  expect(bridge.start).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  await typeAndSend(app.container, "继续这段会话")
  expect(send).toHaveBeenCalledExactlyOnceWith({ sessionId: savedId, text: "继续这段会话" })
  expect(bridge.start).not.toHaveBeenCalled()
})

it("keeps the original conversation and restores the editor when resume fails", async () => {
  const send = vi.fn(async () => {
    throw new Error("SESSION_RESUME_FAILED: 没有同环境的账号")
  })
  const bridge = await openSaved(send)
  await typeAndSend(app.container, "这段输入要保留")
  await flush()
  expect(send).toHaveBeenCalledExactlyOnceWith({ sessionId: savedId, text: "这段输入要保留" })

  expect(app.container.querySelector(".chat-page")?.textContent).toContain("磁盘上的原回复")
  expect(app.container.querySelector(".composer .tiptap")?.textContent).toBe("这段输入要保留")
  expect(app.container.querySelector(".chat-page .turn")?.getAttribute("data-status")).toBe(
    "completed",
  )
  const fallback = app.container.querySelector<HTMLButtonElement>(".session-resume-error button")
  await clickButton(fallback ?? undefined, "新建会话")
  expect(app.container.querySelector(".new-thread-view")).not.toBeNull()
  expect(bridge.start).not.toHaveBeenCalled()
})
