// 验证新窗口加载工作台登记后，已有 worktree 会话仍归到它所属的项目。

// @vitest-environment jsdom
import { act, createElement } from "react"
import { expect, it } from "vitest"
import { DesktopApp } from "./app"
import { desktopAppRoot, flush, installFakeDesktopBridge } from "./test-support/desktop-app-harness"
import { fakeSessionBridge } from "./test-support/session-bridge-fake"

const app = desktopAppRoot()

it("lists an existing worktree session under its registered project in a new window", async () => {
  installFakeDesktopBridge()
  const bridge = window.pigclaude
  if (!bridge?.workspaces) throw new Error("工作区桌面桥尚未安装")
  bridge.workspaces.worktreeProjects = async () => ({ "/work/api-worktree": "/work/api" })
  bridge.session = fakeSessionBridge({
    list: async () => [
      {
        sessionId: "worktree-session",
        workspace: "/work/api-worktree",
        status: "running",
        lastTurn: null,
        turnId: "turn-worktree",
        pendingPermissions: 0,
        pendingQuestions: 0,
        accountId: null,
        model: "claude-sonnet",
        lastActivityAt: "2026-11-14T01:00:00.000Z",
      },
    ],
  }).bridge
  await act(async () => app.root.render(createElement(DesktopApp)))
  await flush()

  const project = [...app.container.querySelectorAll("button.proj")].find(
    (item) => item.textContent?.trim() === "api",
  )
  const row = project?.closest(".proj-block")?.querySelector<HTMLButtonElement>("button.sess")
  expect(row?.dataset.status).toBe("running")
  expect(app.container.querySelectorAll("button.proj")).toHaveLength(2)
})
