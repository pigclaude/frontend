// 验证多个会话的侧栏状态，以及在不同会话之间切换后各自的时间线。
import { expect, test } from "@playwright/test"
import { installChatBridge, type ChatBridgeWindow } from "./chat-bridge"

const time = new Date(2026, 9, 26, 15, 0, 0).getTime()
const snapshots = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

for (const theme of ["light", "dark"] as const) {
  test(`several sessions ${theme}`, async ({ page }) => {
    await page.clock.install({ time })
    await installChatBridge(page)
    await page.addInitScript(() => {
      const { install } = (window as unknown as ChatBridgeWindow).__chatBridge
      const at = new Date().toISOString()
      const session = (sessionId: string, status: string, lastTurn: string | null) => ({
        sessionId,
        workspace: "/Users/me/work/api",
        status,
        lastTurn,
        turnId: status === "running" ? "turn-running" : null,
        pendingPermissions: 0,
        pendingQuestions: 0,
        accountId: "acc-work",
        model: "claude-sonnet",
        lastActivityAt: at,
      })
      install({
        list: async () => [
          session("running", "running", null),
          session("queued", "queued", null),
          session("completed", "idle", "completed"),
          session("interrupted", "interrupted", "interrupted"),
        ],
        events: async ({ sessionId, afterSeq }: { sessionId: string; afterSeq: number }) => {
          if (sessionId !== "completed" || afterSeq > 0) return []
          return [
            { type: "turn-started", turnId: "turn-completed" },
            {
              type: "message",
              messageId: "completed-answer",
              model: "claude-sonnet",
              subagent: null,
              blocks: [{ type: "text", text: "已检查项目结构，测试放在 tests 目录。" }],
            },
            { type: "turn-ended", turnId: "turn-completed", status: "completed", errorCode: null },
          ].map((event, index) => ({ version: 1, sessionId, seq: index + 1, at, event }))
        },
      })
    })
    await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
    await page.evaluate(() => document.fonts.ready)
    const rows = page.locator(".proj-sessions .sess")
    await expect(rows).toHaveCount(4)
    await rows.filter({ has: page.locator(".sess-dot[data-status=completed]") }).click()
    await expect(page.locator(".chat-page")).toContainText("已检查项目结构")
    await expect(page.locator(".sess.is-active")).toHaveAttribute("data-status", "completed")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-multiple-sessions-${theme}.png`, snapshots)
  })
}
