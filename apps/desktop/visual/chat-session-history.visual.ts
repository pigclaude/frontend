// 验证浅色和深色下的已归档会话清单及不可撤销的删除确认。
import { expect, test } from "@playwright/test"
import { installChatBridge, type ChatBridgeWindow } from "./chat-bridge"

const snapshots = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

for (const theme of ["light", "dark"] as const) {
  test(`archived session history ${theme}`, async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 26, 15, 0, 0) })
    await installChatBridge(page)
    await page.addInitScript(() => {
      const { install } = (window as unknown as ChatBridgeWindow).__chatBridge
      const archived = {
        sessionId: "saved-1",
        title: "整理 API 的重试逻辑",
        projectPath: "/Users/me/work/api",
        workspace: "/Users/me/work/api",
        status: "parked",
        lastTurn: "completed",
        turnId: null,
        pendingPermissions: 0,
        pendingQuestions: 0,
        accountId: "acc-work",
        model: "claude-sonnet",
        lastActivityAt: "2026-10-25T07:20:00.000Z",
        archivedAt: "2026-10-26T07:00:00.000Z",
        restorable: true,
      }
      install({
        list: async (input?: { archived?: boolean }) => (input?.archived ? [archived] : []),
        rename: async () => undefined,
        archive: async () => undefined,
        delete: async () => undefined,
      })
    })

    await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
    await page.getByRole("button", { name: "设置", exact: true }).click()
    await page.getByRole("button", { name: "归档管理", exact: true }).click()
    const search = page.getByPlaceholder("搜索已归档会话")
    await search.fill("不存在的会话")
    await expect(page.getByText("没有匹配的会话")).toBeVisible()
    await search.clear()
    await search.blur()
    await expect(page.getByText("整理 API 的重试逻辑")).toBeVisible()
    await expect(page.getByRole("button", { name: "取消归档" })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-session-history-${theme}.png`, snapshots)

    await page.getByRole("button", { name: "删除", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-session-delete-${theme}.png`, snapshots)
  })
}
