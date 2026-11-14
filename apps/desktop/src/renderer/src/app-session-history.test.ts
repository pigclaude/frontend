// 验证侧栏重命名和归档，以及已归档会话的打开、取消归档与删除确认。
// @vitest-environment jsdom
import { act, createElement } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { resetComposerMemory } from "@pigclaude/ui-composer"
import { DesktopApp } from "./app"
import type { SessionHostEvent } from "../../main/session/session-types"
import { clickButton, typeAndSend } from "./test-support/chat-screen-harness"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"
import type { SavedSessionSummary } from "./models/saved-session"

const app = desktopAppRoot()
const at = "2026-10-01T01:02:03.000Z"
const id = "saved"
const agent = { parentToolUseId: "agent-call", agentId: "agent-1" }
const events: SessionHostEvent[] = [
  { type: "started", sessionId: id, model: "claude-sonnet", tools: [], permissionMode: "default" },
  { type: "turn-started", turnId: "turn-saved", userText: "归档前的问题" },
  {
    type: "message",
    messageId: "main-message",
    model: "claude-sonnet",
    subagent: null,
    blocks: [
      {
        type: "tool-use",
        id: agent.parentToolUseId,
        name: "Agent",
        input: { subagent_type: "general-purpose", description: "查阅记录" },
      },
    ],
  },
  {
    type: "message",
    messageId: "agent-message",
    model: "claude-sonnet",
    subagent: agent,
    blocks: [{ type: "text", text: "归档前的子代理记录" }],
  },
  { type: "subagent-ended", ...agent, status: "completed", summary: "已查阅" },
  { type: "turn-ended", turnId: "turn-saved", status: "completed", errorCode: null },
  { type: "ended", reason: "stopped" },
]
const timeline = events.map((event, index) => ({
  version: 1 as const,
  sessionId: id,
  seq: index + 1,
  at,
  event,
}))

afterEach(() => vi.restoreAllMocks())
beforeEach(resetComposerMemory)

function button(title: string, parent: ParentNode = app.container): HTMLButtonElement | undefined {
  return [...parent.querySelectorAll("button")].find((item) => item.textContent?.trim() === title)
}

async function click(title: string, parent?: ParentNode): Promise<void> {
  await clickButton(button(title, parent), title)
  await flush()
}

async function menu(action: string): Promise<void> {
  const row = app.container.querySelector<HTMLElement>(".proj-sessions .sess")
  if (!row) throw new Error("找不到会话行")
  await act(async () => row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })))
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (entry) => entry.textContent?.trim() === action,
  )
  await clickButton(item, action)
  await flush()
}

async function openApp(status: SavedSessionSummary["status"] = "parked") {
  installFakeDesktopBridge()
  let saved: (SavedSessionSummary & { archivedAt: string | null }) | null = {
    sessionId: id,
    title: "原会话",
    workspace: "/work/api-worktree",
    projectPath: "/work/api",
    restorable: true,
    archivedAt: null,
    status,
    lastTurn: "completed",
    turnId: null,
    pendingPermissions: 0,
    pendingQuestions: 0,
    accountId: null,
    model: "claude-sonnet",
    lastActivityAt: at,
  }
  let retention: number | null = null
  const session = fakeSessionBridge({
    events: async ({ sessionId, afterSeq }) =>
      sessionId === id
        ? timeline.filter(
            (entry) =>
              entry.seq > afterSeq && (entry.event.type !== "ended" || saved?.status === "parked"),
          )
        : [],
  })
  const rename = vi.fn(async ({ title }: { title: string }) => {
    if (saved) saved = { ...saved, title }
  })
  const archive = vi.fn(async ({ archived }: { archived: boolean }) => {
    if (saved) saved = { ...saved, archivedAt: archived ? at : null }
  })
  const remove = vi.fn(async () => {
    saved = null
  })
  const clearHistory = vi.fn(async () => {
    saved = null
  })
  const setRetention = vi.fn(async ({ days }: { days: number | null }) => {
    retention = days
    return { days }
  })
  if (!window.pigclaude) throw new Error("桌面桥尚未安装")
  window.pigclaude.session = Object.assign(session.bridge, {
    list: async (input?: { archived?: boolean }) =>
      saved && Boolean(saved.archivedAt) === (input?.archived === true) ? [saved] : [],
    rename,
    archive,
    delete: remove,
    dataStats: async () => (saved ? { count: 1, bytes: 1500 } : { count: 0, bytes: 0 }),
    clearHistory,
    retention: async () => ({ days: retention }),
    setRetention,
  })
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  function expire() {
    if (!saved) throw new Error("会话不存在")
    const removed = {
      sessionId: saved.sessionId,
      projectPath: saved.projectPath ?? saved.workspace,
    }
    saved = null
    session.push({
      version: 1,
      sessionId: null,
      seq: null,
      at,
      event: { type: "sessions-changed", removed },
    })
  }
  function parkArchived() {
    if (!saved) throw new Error("会话不存在")
    saved = { ...saved, status: "parked" }
    const ended = timeline.at(-1)
    if (ended) session.push(ended)
    session.push({
      version: 1,
      sessionId: null,
      seq: null,
      at,
      event: { type: "sessions-changed" },
    })
  }
  return {
    rename,
    archive,
    remove,
    clearHistory,
    setRetention,
    expire,
    parkArchived,
    bridge: session.bridge,
  }
}

it(
  "renames and archives from the sidebar and resumes through the archive",
  { timeout: 15_000 },
  async () => {
    const calls = await openApp()
    await menu("重命名")
    const input = app.container.querySelector<HTMLInputElement>('input[aria-label="会话名称"]')
    if (!input) throw new Error("没有会话重命名输入框")
    await act(async () => {
      const user = userEvent.setup({ delay: null })
      await user.clear(input)
      await user.type(input, "自定义标题{Enter}")
    })
    await flush()
    expect(calls.rename).toHaveBeenCalledWith({ sessionId: id, title: "自定义标题" })
    await clickButton(
      app.container.querySelector<HTMLElement>(".proj-sessions .sess") ?? undefined,
      "会话",
    )
    await flush()
    await clickButton(
      app.container.querySelector<HTMLElement>('[aria-label="在标签页中打开 general-purpose"]') ??
        undefined,
      "打开子代理",
    )
    await menu("归档")
    expect(calls.archive).toHaveBeenCalledWith({ sessionId: id, archived: true })
    expect(app.container.querySelector(".proj-sessions .sess")).toBeNull()
    expect(app.container.querySelector(".subagent-view")?.textContent).toContain(
      "归档前的子代理记录",
    )
    await clickButton(
      app.container.querySelector<HTMLElement>('button[aria-label="搜索"]') ?? undefined,
      "搜索",
    )
    await flush()
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.some((item) => item.textContent?.includes("自定义标题"))).toBe(false)
    await clickButton(
      options.find((item) => item.textContent?.trim() === "已归档"),
      "已归档",
    )
    await flush()
    await click("打开")
    expect(app.container.querySelector(".subagent-view")?.textContent).toContain(
      "归档前的子代理记录",
    )
    await click("回到主会话")
    expect(calls.bridge.start).not.toHaveBeenCalled()
    vi.mocked(calls.bridge.send).mockRejectedValueOnce(new Error("SESSION_RESUME_FAILED: 无法续接"))
    await typeAndSend(app.container, "续接归档会话")
    expect(app.container.querySelector(".composer .tiptap")?.textContent).toBe("续接归档会话")
    expect(app.container.querySelector(".chat-page .turn")?.getAttribute("data-status")).toBe(
      "completed",
    )
    expect(app.container.querySelectorAll(".chat-page .turn")).toHaveLength(1)
    expect(calls.bridge.send).toHaveBeenCalledWith({ sessionId: id, text: "续接归档会话" })
  },
)

it(
  "confirms deletion, keeps failures visible, and returns from a deleted conversation",
  { timeout: 15_000 },
  async () => {
    const calls = await openApp()
    await menu("归档")
    await click("已归档")
    await click("打开")
    await click("已归档")
    await click("删除")
    const dialog = () => document.body.querySelector('[role="dialog"]') ?? document.body
    await click("取消", dialog())
    expect(calls.remove).not.toHaveBeenCalled()

    calls.remove.mockRejectedValueOnce(new Error("删除会话目录失败"))
    await click("删除")
    await click("删除", dialog())
    expect(dialog().textContent).toContain("删除会话目录失败")
    await click("删除", dialog())
    expect(calls.remove).toHaveBeenCalledWith({ sessionId: id })
    const back = app.container.querySelector<HTMLButtonElement>('button[aria-label="后退"]')
    await clickButton(back ?? undefined, "后退")
    await flush()
    expect(app.container.querySelector(".new-thread-view")).not.toBeNull()
    const forward = app.container.querySelector<HTMLButtonElement>('button[aria-label="前进"]')
    await clickButton(forward ?? undefined, "前进")
    await flush()
    await clickButton(
      app.container.querySelector<HTMLElement>("button.nav-item.back") ?? undefined,
      "返回工作区",
    )
    expect(app.container.querySelector(".new-thread-view")).not.toBeNull()
  },
)

it("returns an unarchived session to the sidebar", async () => {
  const calls = await openApp()
  await menu("归档")
  await click("已归档")
  await click("取消归档")
  expect(calls.archive).toHaveBeenLastCalledWith({ sessionId: id, archived: false })
  expect(app.container.textContent).toContain("没有已归档的会话")
  await clickButton(
    app.container.querySelector<HTMLElement>("button.nav-item.back") ?? undefined,
    "返回工作区",
  )
  expect(app.container.querySelector(".proj-sessions .sess")?.textContent).toContain("原会话")
})

it("cannot reopen a conversation the retention policy deleted while it was archived", async () => {
  const calls = await openApp()
  await menu("归档")
  await click("已归档")
  await click("打开")
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("归档前的问题")
  await click("已归档")
  expect(app.container.textContent).toContain("原会话")
  await act(async () => calls.expire())
  await flush()
  expect(app.container.textContent).toContain("没有已归档的会话")
  await clickButton(
    app.container.querySelector<HTMLElement>('button[aria-label="后退"]') ?? undefined,
    "后退",
  )
  await flush()
  expect(app.container.querySelector(".new-thread-view")).not.toBeNull()
  expect(app.container.textContent).not.toContain("归档前的问题")
  await clickButton(
    app.container.querySelector<HTMLElement>('button[aria-label="前进"]') ?? undefined,
    "前进",
  )
  await flush()
  expect(app.container.textContent).toContain("没有已归档的会话")
})

it("returns to the draft when retention deletes the conversation picked by the startup view", async () => {
  window.history.replaceState({}, "", "/?screen=chat")
  const calls = await openApp()
  expect(app.container.querySelector(".chat-page")?.textContent).toContain("归档前的问题")
  await act(async () => calls.expire())
  await flush()
  expect(app.container.querySelector(".new-thread-view")).not.toBeNull()
})

it("resumes an archived session that parked while it was still displayed", async () => {
  const calls = await openApp("idle")
  await clickButton(
    app.container.querySelector<HTMLElement>(".proj-sessions .sess") ?? undefined,
    "会话",
  )
  await flush()
  await menu("归档")
  await act(async () => calls.parkArchived())
  await flush()
  await typeAndSend(app.container, "停放后续接")
  expect(calls.bridge.send).toHaveBeenCalledWith({ sessionId: id, text: "停放后续接" })
  expect(calls.bridge.start).not.toHaveBeenCalled()
})

it(
  "shows session space, confirms clearing, and enables or disables retention",
  { timeout: 15_000 },
  async () => {
    const calls = await openApp()
    await click("已归档")
    await click("数据与隐私")
    expect(app.container.textContent).toContain("1,500")
    await click("清除全部会话")
    let dialog = document.body.querySelector('[role="dialog"]') ?? document.body
    expect(dialog.textContent).toContain("清除全部会话？")
    await click("取消", dialog)
    expect(calls.clearHistory).not.toHaveBeenCalled()
    await click("清除全部会话")
    dialog = document.body.querySelector('[role="dialog"]') ?? document.body
    await click("清除全部会话", dialog)
    expect(calls.clearHistory).toHaveBeenCalledOnce()
    expect(button("清除全部会话")?.disabled).toBe(true)

    await click("会话")
    const control = () =>
      app.container.querySelector<HTMLElement>('[role="switch"][aria-label="自动删除未活动的会话"]')
    expect(control()?.getAttribute("aria-checked")).toBe("false")
    await clickButton(control() ?? undefined, "自动删除未活动的会话")
    await flush()
    expect(calls.setRetention).not.toHaveBeenCalled()
    const days = app.container.querySelector<HTMLInputElement>('input[aria-label="保留天数"]')
    if (!days) throw new Error("未显示保留天数")
    await act(async () => {
      const user = userEvent.setup({ delay: null })
      await user.clear(days)
      await user.type(days, "7")
    })
    await click("保存")
    expect(calls.setRetention).toHaveBeenLastCalledWith({ days: 7 })
    await clickButton(control() ?? undefined, "关闭自动删除")
    await flush()
    expect(calls.setRetention).toHaveBeenLastCalledWith({ days: null })
  },
)
