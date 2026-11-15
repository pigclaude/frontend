// 验证同一个项目的会话可从侧栏各自打开，切换时每个会话继续接收自己的事件。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { expect, it, vi } from "vitest"
import { DesktopApp } from "./app"
import { typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"
import type { SessionSummary } from "../../main/session/session-summary"
import type {
  SessionBridge,
  SessionEnvelope,
  SessionHostEvent,
} from "../../main/session/session-types"
import { syntheticJpegBase64 } from "../../test-support/synthetic-jpeg"

const app = desktopAppRoot()
const at = "2026-11-14T01:00:00.000Z"

function summary(id: string, workspace: string): SessionSummary {
  return {
    sessionId: id,
    workspace,
    status: "running",
    lastTurn: null,
    turnId: `turn-${id}`,
    pendingPermissions: 0,
    pendingQuestions: 0,
    accountId: null,
    model: "claude-sonnet",
    lastActivityAt: at,
  }
}

function projectRows(name: string): HTMLButtonElement[] {
  const header = [...app.container.querySelectorAll("button.proj")].find(
    (item) => item.textContent?.trim() === name,
  )
  return [
    ...(header?.closest(".proj-block")?.querySelectorAll<HTMLButtonElement>("button.sess") ?? []),
  ]
}

it("lists running sessions by project and shows each background reply when selected", async () => {
  installFakeDesktopBridge()
  const session = fakeSessionBridge({
    list: vi.fn(async () => [summary("one", "/work/api"), summary("two", "/work/web")]),
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()

  await act(async () => {
    for (const [id, text] of [
      ["one", "第一条回复"],
      ["two", "第二条回复"],
    ] as const) {
      session.push({
        version: 1,
        sessionId: id,
        seq: 1,
        at,
        event: { type: "turn-started", turnId: `turn-${id}` },
      })
      session.push({
        version: 1,
        sessionId: id,
        seq: null,
        at,
        event: { type: "delta", text, thinking: false, blockIndex: 0 },
      })
    }
  })
  await flush()

  const first = projectRows("api")[0]
  const second = projectRows("web")[0]
  expect(first?.dataset.status).toBe("running")
  expect(second?.dataset.status).toBe("running")
  await act(async () => first?.click())
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("第一条回复")
  await act(async () => second?.click())
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("第二条回复")
  expect(app.container.querySelector(".chat-page")?.textContent).not.toContain("第一条回复")
  expect(session.bridge.stop).not.toHaveBeenCalled()
  expect(session.bridge.cancel).not.toHaveBeenCalled()
})

it("reads a parked session without waiting for a later event and refreshes the queue", async () => {
  installFakeDesktopBridge()
  const old = { ...summary("one", "/work/api"), status: "parked", lastTurn: "completed" } as const
  const pending = { ...summary("two", "/work/web"), status: "queued", turnId: null } as const
  const list = vi.fn(async (): Promise<SessionSummary[]> => [old, pending])
  const session = fakeSessionBridge({
    list,
    events: vi.fn<SessionBridge["events"]>(async ({ sessionId, afterSeq }) =>
      sessionId !== "one" || afterSeq !== 0
        ? []
        : [
            {
              version: 1,
              sessionId,
              seq: 1,
              at,
              event: { type: "turn-started", turnId: "old-turn" },
            },
            {
              version: 1,
              sessionId,
              seq: 2,
              at,
              event: {
                type: "message",
                messageId: "old-reply",
                model: "claude-sonnet",
                subagent: null,
                blocks: [{ type: "text", text: "旧会话完整回复" }],
              },
            },
            {
              version: 1,
              sessionId,
              seq: 3,
              at,
              event: {
                type: "turn-ended",
                turnId: "old-turn",
                status: "completed",
                errorCode: null,
              },
            },
            { version: 1, sessionId, seq: 4, at, event: { type: "ended", reason: "stopped" } },
          ],
    ),
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  expect(projectRows("api")[0]?.dataset.status).toBe("completed")
  expect(projectRows("web")[0]?.dataset.status).toBe("queued")
  await act(async () => projectRows("api")[0]?.click())
  await flush()
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("旧会话完整回复")

  list.mockResolvedValue([old, { ...pending, status: "running" }])
  await act(async () =>
    session.push({
      version: 1,
      sessionId: null,
      seq: null,
      at,
      event: { type: "sessions-changed" },
    }),
  )
  expect(projectRows("web")[0]?.dataset.status).toBe("running")
})

const screenshotTool = "mcp__pigclaude_workbench__browser_screenshot"

function screenshotTimeline(
  sessionId: string,
  result: Extract<SessionHostEvent, { type: "tool-result" }>,
): SessionEnvelope[] {
  const turnId = `turn-${sessionId}`
  const events: SessionHostEvent[] = [
    { type: "turn-started", turnId, userText: "截取本机预览" },
    {
      type: "message",
      messageId: `request-${sessionId}`,
      model: "claude-sonnet",
      subagent: null,
      blocks: [{ type: "tool-use", id: result.toolUseId, name: screenshotTool, input: {} }],
    },
    result,
    { type: "turn-ended", turnId, status: "completed", errorCode: null },
  ]
  return events.map((event, index) => ({ version: 1, sessionId, seq: index + 1, at, event }))
}

it("shows a live browser screenshot only in the session that owns its tool result", async () => {
  installFakeDesktopBridge()
  const session = fakeSessionBridge({
    list: vi.fn(async () => [summary("one", "/work/api"), summary("two", "/work/web")]),
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()

  const first = projectRows("api")[0]
  const second = projectRows("web")[0]
  await act(async () => first?.click())
  const envelopes = screenshotTimeline("one", {
    type: "tool-result",
    toolUseId: "screenshot-call",
    content: "Captured the local preview",
    image: { type: "image", mimeType: "image/jpeg", data: syntheticJpegBase64 },
    subagent: null,
    isError: false,
  })
  await act(async () => {
    for (const envelope of envelopes) session.push(envelope)
    session.push({
      version: 1,
      sessionId: "two",
      seq: 1,
      at,
      event: { type: "turn-started", turnId: "turn-two", userText: "另一会话的任务" },
    })
  })

  const screenshot = () => app.container.querySelector('.chat-page img[alt="截图"]')
  expect(screenshot()?.getAttribute("src")).toBe(`data:image/jpeg;base64,${syntheticJpegBase64}`)
  await act(async () => second?.click())
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("另一会话的任务")
  expect(screenshot()).toBeNull()
  await act(async () => first?.click())
  expect(screenshot()?.getAttribute("src")).toBe(`data:image/jpeg;base64,${syntheticJpegBase64}`)
})

it("shows the screenshot placeholder in a reloaded session timeline", async () => {
  installFakeDesktopBridge()
  const parked = {
    ...summary("one", "/work/api"),
    status: "parked",
    lastTurn: "completed",
  } as const
  const history = screenshotTimeline("one", {
    type: "tool-result",
    toolUseId: "history-screenshot-call",
    content: "[截图未保存]",
    subagent: null,
    isError: false,
  })
  const session = fakeSessionBridge({
    list: vi.fn(async () => [parked]),
    events: vi.fn<SessionBridge["events"]>(async ({ sessionId, afterSeq }) =>
      sessionId === "one" ? history.filter((entry) => (entry.seq ?? 0) > afterSeq) : [],
    ),
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await act(async () => projectRows("api")[0]?.click())
  await flush()

  const chat = app.container.querySelector(".chat-page")
  const screenshot = [
    ...(chat?.querySelectorAll<HTMLElement>('[role="button"][aria-expanded]') ?? []),
  ].find((row) => row.textContent?.includes("截图"))
  expect(screenshot).toBeDefined()
  await act(async () => screenshot?.click())
  expect(chat?.textContent).toContain("[截图未保存]")
  expect(chat?.querySelector('img[alt="截图"]')).toBeNull()
})

it("waits for the existing history before adding the next user turn", async () => {
  installFakeDesktopBridge()
  let finishHistory: (page: Awaited<ReturnType<SessionBridge["events"]>>) => void = () => undefined
  const history = new Promise<Awaited<ReturnType<SessionBridge["events"]>>>((resolve) => {
    finishHistory = resolve
  })
  const selected = summary("one", "/work/api")
  const send = vi.fn(async () => undefined)
  const session = fakeSessionBridge({
    list: async () => [{ ...selected, status: "idle", turnId: null }],
    status: async () => ({
      ...selected,
      active: true,
      turnId: null,
      permissionMode: "default",
    }),
    events: ({ afterSeq }) => (afterSeq === 0 ? history : Promise.resolve([])),
    send,
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await act(async () => projectRows("api")[0]?.click())
  await flush()

  await typeAndSend(app.container, "新的一轮")
  const sentBeforeHistory = send.mock.calls.length
  await act(async () =>
    finishHistory([
      { version: 1, sessionId: "one", seq: 1, at, event: { type: "turn-started", turnId: "old" } },
      {
        version: 1,
        sessionId: "one",
        seq: 2,
        at,
        event: { type: "turn-ended", turnId: "old", status: "completed", errorCode: null },
      },
    ]),
  )
  await flush()

  expect(sentBeforeHistory).toBe(0)
  const editor = app.container.querySelector<HTMLElement>(".composer .tiptap")
  expect(editor?.textContent).toBe("新的一轮")
  await act(async () =>
    editor?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  )
  expect(send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      sessionId: "one",
      text: "新的一轮",
    }),
  )
})

it("retries an unfinished history from its last received page when reopening the session", async () => {
  installFakeDesktopBridge()
  const selected = summary("one", "/work/api")
  const page = (seq: number, text: string) => ({
    version: 1 as const,
    sessionId: "one",
    seq,
    at,
    event: {
      type: "message" as const,
      messageId: `reply-${seq}`,
      model: "claude-sonnet",
      subagent: null,
      blocks: [{ type: "text" as const, text }],
    },
  })
  let didFail = false
  const events = vi.fn<SessionBridge["events"]>(async ({ sessionId, afterSeq }) => {
    if (sessionId !== "one" || afterSeq > 1) return []
    if (afterSeq === 0) return [page(1, "第一份历史")]
    if (!didFail) {
      didFail = true
      throw new Error("fixture unavailable")
    }
    return [page(2, "第二份历史")]
  })
  const session = fakeSessionBridge({
    list: async () => [selected, summary("two", "/work/web")],
    events,
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  await act(async () => projectRows("api")[0]?.click())
  await flush()
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("第一份历史")

  await act(async () => projectRows("web")[0]?.click())
  await act(async () => projectRows("api")[0]?.click())
  await flush()
  expect(
    events.mock.calls
      .filter(([input]) => input.sessionId === "one")
      .map(([input]) => input.afterSeq),
  ).toEqual([0, 1, 1, 2])
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("第二份历史")
})
