// 负责输入框上下文占用圆环的视觉回归：一轮结束后会话报来占用，输入框显示圆环，
// 悬停时显示已用、上限和离自动压缩还剩多少。浅色和深色各一套。
// 页面加载前装上共用的内存桌面桥，发送后按信封回放一轮和一条 context 事件。
import { expect, test, type Page } from "@playwright/test"
import { installChatBridge, type ChatBridgeWindow } from "./chat-bridge"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

async function openChat(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.clock.install({ time: FIXED_TIME })
  await installChatBridge(page)
  await page.addInitScript(() => {
    const { emit, assistant, install } = (window as unknown as ChatBridgeWindow).__chatBridge
    const reply = () => {
      emit({ type: "account-switched", from: null, to: "acc-work", reason: "initial" })
      emit({ type: "turn-started", turnId: "turn-1" })
      emit(assistant("m-1", [{ type: "text", text: "重试逻辑已经改好，测试也补上了。" }]))
      emit({
        type: "result",
        subtype: "success",
        isError: false,
        durationMs: 10,
        numTurns: 1,
        stopReason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
      })
      emit({ type: "turn-ended", turnId: "turn-1", status: "completed", errorCode: null })
      emit({ type: "context", usedTokens: 142_500, maxTokens: 200_000, autoCompactTokens: 167_000 })
    }
    install({
      send: async () => {
        setTimeout(reply)
      },
    })
  })
  await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
  const editor = page.locator(".composer .tiptap")
  await editor.click()
  await editor.pressSequentially("改一下重试逻辑")
  await editor.press("Enter")
}

for (const theme of ["light", "dark"] as const) {
  test(`context meter ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    await expect(page.locator(".msg-ai").last()).toContainText("测试也补上了")
    const meter = page.locator(".composer .context-meter")
    await expect(meter).toHaveAttribute("data-level", "high")
    await meter.hover()
    await expect(page.locator(".context-meter-tip")).toContainText("到 167k 自动压缩，还剩 25k")
    await expect(page).toHaveScreenshot(`chat-context-meter-${theme}.png`, options)
  })
}
