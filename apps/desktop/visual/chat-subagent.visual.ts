// 负责子代理的视觉回归：后台子代理运行中时，时间线里的子代理卡显示最近一次工具调用，线程头的
// 子代理标签在它等待权限回答时显示等待；子代理结束后点开卡片，标签页里是它的只读过程和交回的结果。
// 浅色和深色各一套。页面加载前装上共用的内存桌面桥，发送后按信封推送子代理的事件。
import { expect, test, type Page } from "@playwright/test"
import { installChatBridge, type ChatBridgeWindow } from "./chat-bridge"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

/** 发送前把时钟停住，之后只按固定步长拨动，一轮显示的「已工作」时长不受点击快慢影响。 */
const SEND_AT = FIXED_TIME + 60_000
const STEP_MS = 1_000

async function openChat(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.clock.install({ time: FIXED_TIME })
  await installChatBridge(page)
  await page.addInitScript(() => {
    const { emit, assistant, install } = (window as unknown as ChatBridgeWindow).__chatBridge
    const call = "call-agent"
    const owned = { parentToolUseId: call, agentId: "agent-1" }
    const work = () => {
      emit({ type: "account-switched", from: null, to: "acc-work", reason: "initial" })
      emit({ type: "turn-started", turnId: "turn-1" })
      emit(
        assistant("m-1", [
          {
            type: "tool-use",
            id: call,
            name: "Agent",
            input: {
              subagent_type: "general-purpose",
              description: "排查失败的测试",
              prompt: "运行 pnpm test，找出失败的用例并说明原因。",
              run_in_background: true,
            },
          },
        ]),
      )
      emit({
        type: "tool-result",
        toolUseId: call,
        content: "Async agent launched successfully.",
        isError: false,
      })
      emit(assistant("m-2", [{ type: "text", text: "已派一个子代理在后台排查测试。" }]))
      emit(assistant("s-1", [{ type: "thinking", text: "先跑一遍测试看看哪些失败。" }], owned))
      emit(assistant("s-1", [{ type: "text", text: "我先跑一遍完整的测试。" }], owned))
      emit(
        assistant(
          "s-1",
          [{ type: "tool-use", id: "bash-1", name: "Bash", input: { command: "pnpm test" } }],
          owned,
        ),
      )
      emit({
        type: "permission",
        requestId: "p-1",
        toolName: "Bash",
        input: { command: "pnpm test" },
        ...owned,
      })
    }
    const finish = () => {
      emit({
        type: "tool-result",
        toolUseId: "bash-1",
        content: "1 failed: retries the request after a timeout",
        isError: false,
        ...owned,
      })
      emit(
        assistant(
          "s-2",
          [{ type: "text", text: "超时重试的用例失败了：重试次数少算了一次。" }],
          owned,
        ),
      )
      emit({
        type: "subagent-ended",
        ...owned,
        status: "completed",
        summary: "一个用例失败：超时后的重试次数少算了一次，修正循环条件即可。",
      })
      emit(assistant("m-3", [{ type: "text", text: "子代理找到了原因：重试次数少算了一次。" }]))
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
    }
    install({
      send: async () => {
        setTimeout(work)
      },
      respondPermission: async () => {
        setTimeout(finish)
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
  await editor.pressSequentially("帮我查一下测试为什么失败")
  await page.clock.pauseAt(SEND_AT)
  await editor.press("Enter")
  await page.clock.runFor(STEP_MS)
}

for (const theme of ["light", "dark"] as const) {
  test(`subagent waiting ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    const tab = page.locator('[data-tab-id="spawned:call-agent"]')
    await expect(tab.getByRole("img", { name: "等待许可" })).toBeVisible()
    await expect(page.locator(".subagent-row")).toContainText("pnpm test")
    await expect(page.locator(".perm-prompt")).toContainText("pnpm test")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-subagent-waiting-${theme}.png`, options)
  })

  test(`subagent tab ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    await page.getByRole("button", { name: "确认" }).click()
    await page.clock.runFor(STEP_MS)
    await expect(page.locator(".msg-ai").last()).toContainText("重试次数少算了一次")
    await page.locator(".work-toggle").click()
    await page.getByRole("button", { name: "在标签页中打开 general-purpose" }).click()
    await expect(page.locator(".subagent-view-result")).toContainText("修正循环条件")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-subagent-tab-${theme}.png`, options)
  })
}
