// 验证托盘菜单只展示用户能安全看到的摘要，并能跳转到所有等待审批的会话。

import { expect, it } from "vitest"
import { buildTrayMenu } from "./tray-menu"

it("限制运行列表，保留跨会话待审批总数，并只跳到对应会话", () => {
  const sessions = Array.from({ length: 7 }, (_, index) => ({
    sessionId: `session-${index}`,
    projectName: `项目 ${index}`,
    title: index === 0 ? "用户命名\n第一轮" : null,
    pendingApprovals: index === 0 ? 1 : index === 6 ? 2 : 0,
    prompt: "PRIVATE_PROMPT",
    toolInput: { token: "PRIVATE_INPUT" },
  }))
  const accounts = [
    { enabled: true, needsReauth: true, email: "private@example.test" },
    { enabled: false, needsReauth: false },
    { enabled: true, needsReauth: false, exhaustedUntil: "2026-11-15T02:00:00Z" },
    { enabled: true, needsReauth: false, exhaustedUntil: "2026-11-14T23:59:00Z" },
  ]
  const now = Date.parse("2026-11-15T00:00:00Z")
  const menu = buildTrayMenu({
    membership: "active",
    sessions,
    accounts,
    now,
  })

  expect(menu.pendingApprovals).toBe(3)
  expect(menu.items).toEqual(
    expect.arrayContaining([
      { id: "membership", label: "会员有效" },
      {
        id: "sessions",
        label: "运行中的会话（7）",
        submenu: [
          {
            id: "session-session-0",
            label: "用户命名 第一轮 · 项目 0",
            action: { kind: "session", sessionId: "session-0" },
          },
          ...[1, 2, 3, 4].map((index) => ({
            id: `session-session-${index}`,
            label: `项目 ${index}`,
            action: { kind: "session", sessionId: `session-${index}` },
          })),
        ],
      },
      {
        id: "approvals",
        label: "待审批（3）",
        submenu: [
          {
            id: "approval-session-0",
            label: "用户命名 第一轮 · 项目 0（1）",
            action: { kind: "session", sessionId: "session-0" },
          },
          {
            id: "approval-session-6",
            label: "项目 6（2）",
            action: { kind: "session", sessionId: "session-6" },
          },
        ],
      },
      { id: "accounts", label: "Claude 账号需要处理（3）", action: { kind: "accounts" } },
      { id: "new-session", label: "新会话", action: { kind: "new-session" } },
      { id: "open-window", label: "打开窗口", action: { kind: "open-window" } },
      { id: "quit", label: "退出", action: { kind: "quit" } },
    ]),
  )
  expect(JSON.stringify(menu)).not.toMatch(/PRIVATE|private@example.test|批准|拒绝/)
})
