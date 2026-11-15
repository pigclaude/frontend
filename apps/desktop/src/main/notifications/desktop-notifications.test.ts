// 用 Electron 的合成通知器验证读会话索引、项目名和原生失败、点击事件的接线。

import type { EventEmitter } from "node:events"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { ProjectNameStore } from "../runtime/project-names"
import { SessionStore } from "../session/session-store"
import {
  envelopeOf,
  newSessionIndex,
  removeTemporaryDirs,
  temporaryDir,
} from "../session/session-store-fixtures"
import { createDesktopNotifications } from "./desktop-notifications"

const fixture = vi.hoisted(() => ({
  items: [] as Array<
    EventEmitter & { content: { title: string; body: string }; close: () => void }
  >,
  supported: true,
  packaged: false,
  setAppUserModelId: vi.fn(),
  show: vi.fn(),
}))

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  class SyntheticNotification extends EventEmitter {
    static isSupported(): boolean {
      return fixture.supported
    }

    constructor(readonly content: { title: string; body: string }) {
      super()
      fixture.items.push(this)
    }

    show = fixture.show
    close = vi.fn()
  }
  return {
    Notification: SyntheticNotification,
    app: {
      get isPackaged() {
        return fixture.packaged
      },
      setAppUserModelId: fixture.setAppUserModelId,
    },
  }
})

afterEach(async () => {
  fixture.items.length = 0
  fixture.supported = true
  fixture.packaged = false
  fixture.setAppUserModelId.mockReset()
  fixture.show.mockReset()
  await removeTemporaryDirs()
})

async function harness(platform: NodeJS.Platform = "darwin") {
  const userDataPath = await temporaryDir()
  const openWindow = vi.fn()
  const openSession = vi.fn()
  const trayBadge = vi.fn()
  const notifications = createDesktopNotifications({
    userDataPath,
    platform,
    window: () => null,
    openWindow,
    openSession,
    trayBadge,
  })
  return { notifications, userDataPath, openSession, openWindow, trayBadge }
}

it("从本机会话索引读取用户标题和项目名，系统点击打开对应会话", async () => {
  const { notifications, userDataPath, openSession } = await harness()
  const store = await SessionStore.open({ root: join(userDataPath, "sessions") })
  const projectPath = "/private/workspace/project"
  await store.create(
    newSessionIndex("session-b", { title: "交付审查", titleSource: "user", projectPath }),
  )
  await new ProjectNameStore({ filePath: join(userDataPath, "project-names.json") }).rename(
    projectPath,
    "发布项目",
    [projectPath],
  )
  notifications.session(
    envelopeOf("session-b", 1, {
      type: "permission",
      requestId: "internal",
      toolName: "Bash",
      input: { command: "private" },
      subagent: null,
    }),
    Promise.resolve(store),
  )
  await vi.waitFor(() => expect(fixture.show).toHaveBeenCalledOnce())
  expect(fixture.items[0]?.content).toEqual({
    title: "PigClaude",
    body: "需要审批 · 发布项目 · 交付审查 · Bash",
  })
  fixture.items[0]?.emit("click")
  expect(openSession).toHaveBeenCalledExactlyOnceWith("session-b")
  notifications.dispose()
})

it("macOS 系统通知不可用或报告失败时显示托盘角标", async () => {
  const { notifications, trayBadge } = await harness()
  fixture.supported = false
  notifications.announce({ kind: "completed", sessionId: "session-a" })
  expect(fixture.items).toHaveLength(0)
  expect(trayBadge).toHaveBeenCalledExactlyOnceWith(true)

  notifications.windowFocused()
  fixture.supported = true
  notifications.announce({ kind: "completed", sessionId: "session-a" })
  fixture.items[0]?.emit("failed", {}, "private-os-error")
  expect(trayBadge.mock.calls).toEqual([[true], [false], [true]])
  notifications.dispose()
})

it("Windows 横幅超时后仍可点击；退出时关闭其余原生通知", async () => {
  const { notifications, openSession } = await harness("win32")
  notifications.announce({ kind: "completed", sessionId: "session-a" })
  notifications.announce({ kind: "failed", sessionId: "session-b" })
  fixture.items[0]?.emit("close", { reason: "timedOut" })
  fixture.items[1]?.emit("close", { reason: "timedOut" })
  fixture.items[0]?.emit("click")
  expect(openSession).toHaveBeenCalledExactlyOnceWith("session-a")
  notifications.dispose()
  expect(fixture.items[0]?.close).not.toHaveBeenCalled()
  expect(fixture.items[1]?.close).toHaveBeenCalledOnce()
})

it("Windows 按通知中心的 20 条上限释放最旧的超时通知，仍可点击最新的通知", async () => {
  const { notifications, openSession } = await harness("win32")
  for (let id = 0; id < 21; id += 1) {
    notifications.announce({ kind: "completed", sessionId: `session-${id}` })
    fixture.items[id]?.emit("close", { reason: "timedOut" })
  }
  expect(fixture.items[0]?.close).toHaveBeenCalledOnce()
  fixture.items[0]?.emit("click")
  expect(openSession).not.toHaveBeenCalled()
  fixture.items[20]?.emit("click")
  expect(openSession).toHaveBeenCalledExactlyOnceWith("session-20")
  notifications.dispose()
})

it("已安装的 Windows 应用使用 NSIS 开始菜单的身份发送通知", async () => {
  fixture.packaged = true
  const { notifications } = await harness("win32")
  expect(fixture.setAppUserModelId).toHaveBeenCalledExactlyOnceWith("com.pigclaude.desktop")
  notifications.dispose()
})
