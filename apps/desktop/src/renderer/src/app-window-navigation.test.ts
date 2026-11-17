// 验证托盘和通知发出的导航经过实际主窗口的位置历史，可打开归档会话和新会话草稿。
// @vitest-environment jsdom

import { act, createElement } from "react"
import { expect, it, vi } from "vitest"
import type { WindowNavigationCommand } from "../../window-navigation-contract"
import { DesktopApp } from "./app"
import type { SavedSessionSummary } from "./models/saved-session"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge, idleStatus } from "./test-support/session-bridge-fake"

const app = desktopAppRoot()

it("启动时没有可恢复的会话就显示可选择项目的草稿", async () => {
  const { starts } = installFakeDesktopBridge(["/work/api"])
  window.history.replaceState({}, "", "/?screen=chat")
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()

  expect(app.container.querySelector('button[aria-label="会话所在的项目: api"]')).not.toBeNull()
  expect(starts).toHaveLength(0)
})

it("托盘可打开运行中的归档会话，再跳到账号页或新的草稿", async () => {
  installFakeDesktopBridge()
  const bridge = window.pigclaude
  if (!bridge) throw new Error("未安装桌面桥")
  let navigate: (command: WindowNavigationCommand) => void = () => undefined
  bridge.window = {
    onNavigation: (listener) => {
      navigate = listener
      return () => {
        navigate = () => undefined
      }
    },
    control: async () => undefined,
    getCloseToTray: async () => false,
    setCloseToTray: async (value) => value,
    isMaximized: async () => false,
    isFullScreen: async () => false,
    onFullScreenChange: () => () => undefined,
    setTitleBarColors: async () => undefined,
    setTranslucent: async () => undefined,
    popupMenu: async () => null,
  }
  const archived: SavedSessionSummary = {
    sessionId: "archived-live",
    workspace: "/work/web",
    projectPath: "/work/web",
    title: "正在运行的归档会话",
    status: "waiting-approval",
    restorable: true,
    archivedAt: "2026-11-15T00:00:00Z",
    turnId: "turn",
    lastTurn: null,
    pendingPermissions: 1,
    pendingQuestions: 0,
    accountId: null,
    model: null,
    lastActivityAt: "2026-11-15T00:00:00Z",
  }
  const session = fakeSessionBridge({
    rename: async () => undefined,
    archive: async () => undefined,
    list: async (input) => (input?.archived ? [archived] : []),
    status: vi.fn(async (target) =>
      target?.sessionId === archived.sessionId
        ? { ...idleStatus, active: true, sessionId: archived.sessionId, pendingPermissions: 1 }
        : idleStatus,
    ),
  })
  bridge.session = session.bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()
  const screen = () =>
    app.container.querySelector("[data-main-window]")?.getAttribute("data-screen")

  await act(async () => navigate({ kind: "session", sessionId: archived.sessionId }))
  await flush()
  expect(screen()).toBe("chat")
  expect(session.bridge.status).toHaveBeenCalledWith({ sessionId: archived.sessionId })
  expect(session.bridge.respondPermission).not.toHaveBeenCalled()

  await act(async () => navigate({ kind: "accounts" }))
  expect(screen()).toBe("accounts")
  await act(async () => navigate({ kind: "new-session" }))
  expect(screen()).toBe("chat-new")
  expect(session.bridge.start).not.toHaveBeenCalled()
})
