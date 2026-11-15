// 从真实侧栏菜单发起会话引用，验证切换项目草稿不会串入引用或丢失失败的输入。
// @vitest-environment jsdom
import { act, createElement } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { requestComposerContext, resetComposerMemory } from "@pigclaude/ui-composer"
import type { SessionBridge } from "../../main/session/session-types"
import { DesktopApp } from "./app"
import type { SavedSessionSummary } from "./models/saved-session"
import { clickButton } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"

const app = desktopAppRoot()
beforeEach(resetComposerMemory)

const source: SavedSessionSummary = {
  sessionId: "source-id",
  title: "参考会话",
  workspace: "/work/web",
  projectPath: "/work/web",
  restorable: true,
  status: "parked",
  lastTurn: "completed",
  turnId: null,
  pendingPermissions: 0,
  pendingQuestions: 0,
  accountId: null,
  model: "claude-sonnet",
  lastActivityAt: "2026-11-14T01:00:00.000Z",
}

async function newDraft(project: string): Promise<void> {
  const row = [...app.container.querySelectorAll("button.proj")].find(
    (item) => item.textContent?.trim() === project,
  )
  const button = row?.closest(".proj-row")?.querySelector<HTMLElement>(".proj-add")
  await clickButton(button ?? undefined, `${project} 的新会话按钮`)
  await flush()
}

async function referenceFromSidebar(): Promise<void> {
  const row = app.container.querySelector<HTMLElement>(".proj-sessions .sess")
  expect(row?.textContent).toContain("参考会话")
  await act(async () => row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entry) => entry.textContent?.trim() === "在输入框里引用",
  )
  await clickButton(item, "在输入框里引用")
  await flush()
}

async function openApp(start?: SessionBridge["start"]): Promise<SessionBridge> {
  installFakeDesktopBridge()
  const session = fakeSessionBridge({
    ...(start ? { start } : {}),
    list: async (input) => (input?.archived ? [] : [source]),
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = Object.assign(session.bridge, {
    rename: async () => undefined,
    archive: async () => undefined,
  })
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  return session.bridge
}

it("inserts in the current project draft and restores the chip after a failed background start", async () => {
  let failStart: (error: Error) => void = () => undefined
  const pending = new Promise<Awaited<ReturnType<SessionBridge["start"]>>>((_, reject) => {
    failStart = reject
  })
  const start = vi
    .fn<SessionBridge["start"]>(async ({ sessionId }) => ({ sessionId: sessionId ?? "draft" }))
    .mockReturnValueOnce(pending)
  const session = await openApp(start)

  const chip = () => app.container.querySelector(".tiptap .mention-chip")
  const attachment = () => app.container.querySelector(".composer-context")
  const send = () =>
    clickButton(
      app.container.querySelector<HTMLButtonElement>('button[aria-label="发送"]') ?? undefined,
      "发送",
    )

  await referenceFromSidebar()
  expect(chip()?.textContent).toBe("@参考会话")
  expect(start).not.toHaveBeenCalled()
  expect(session.send).not.toHaveBeenCalled()
  await act(async () =>
    requestComposerContext({ id: "attachment", label: "附件", markdown: "附件正文" }),
  )
  await send()
  expect(start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspace: "/work/api" }))

  await newDraft("web")
  await act(async () => failStart(new Error("NO_AVAILABLE_ACCOUNT: fixture")))
  expect(chip()).toBeNull()
  expect(attachment()).toBeNull()
  await newDraft("api")

  expect(chip()?.textContent).toBe("@参考会话")
  expect(attachment()?.textContent).toBe("附件")
  expect(session.send).not.toHaveBeenCalled()
  await send()
  expect(session.send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      text: "@参考会话\n\n附件正文",
      references: [{ kind: "thread", threadId: source.sessionId, title: "参考会话" }],
    }),
  )
})
