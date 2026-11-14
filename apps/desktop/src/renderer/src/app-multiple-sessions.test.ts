// 验证同一个项目的会话可从侧栏各自打开，切换时每个会话继续接收自己的事件。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { expect, it, vi } from "vitest"
import { DesktopApp } from "./app"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"
import type { SessionSummary } from "../../main/session/session-summary"
import type { SessionBridge } from "../../main/session/session-types"

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
