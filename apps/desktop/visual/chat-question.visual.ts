// 负责提问卡的视觉回归：Claude 用 AskUserQuestion 提问时，提问卡显示在这一轮里（一个单选、一个多选），
// 回答后卡片换成「已询问」的历史行，展开后逐条列出问题和答案。浅色和深色各一套。
// 页面加载前装上共用的内存桌面桥，发送后提问，回答后按信封结束这一轮。
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
    const questions = [
      {
        question: "重试的上限定为几次？",
        header: "重试次数",
        multiSelect: false,
        options: [
          { label: "3 次", description: "和现有的网络请求一致" },
          { label: "5 次", description: "慢网络下更稳" },
        ],
      },
      {
        question: "哪些错误需要重试？",
        header: "错误类型",
        multiSelect: true,
        options: [{ label: "超时" }, { label: "连接被重置" }, { label: "HTTP 503" }],
      },
    ]
    const ask = () => {
      emit({ type: "account-switched", from: null, to: "acc-work", reason: "initial" })
      emit({ type: "turn-started", turnId: "turn-1" })
      emit(
        assistant("m-1", [{ type: "thinking", text: "重试次数和错误类型要先和用户确认。" }], {
          thinkingMs: 2_100,
        }),
      )
      emit(
        assistant("m-1", [
          { type: "tool-use", id: "tool-ask", name: "AskUserQuestion", input: { questions } },
        ]),
      )
      emit({ type: "question", requestId: "q-1", questions })
    }
    const answer = (answers: string[]) => {
      emit({ type: "question-resolved", requestId: "q-1", answers })
      emit({
        type: "tool-result",
        toolUseId: "tool-ask",
        content: "Your questions have been answered.",
        isError: false,
        subagent: null,
      })
      emit(assistant("m-2", [{ type: "text", text: "好的，最多重试 3 次，只重试超时和 503。" }]))
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
        setTimeout(ask)
      },
      answerQuestion: async (input: { answers: string[] }) => {
        setTimeout(() => answer(input.answers))
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
  await editor.pressSequentially("给请求加上重试")
  await page.clock.pauseAt(SEND_AT)
  await editor.press("Enter")
  await page.clock.runFor(STEP_MS)
}

for (const theme of ["light", "dark"] as const) {
  test(`question card ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    const card = page.locator("form.question-card")
    await expect(card).toContainText("哪些错误需要重试？")
    await card.getByText("3 次", { exact: true }).click()
    await card.getByText("超时", { exact: true }).click()
    await card.getByText("HTTP 503", { exact: true }).click()
    await expect(page.locator(".work-head")).toContainText("等待回答")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-question-card-${theme}.png`, options)
  })

  test(`question answered ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    const card = page.locator("form.question-card")
    await card.getByText("3 次", { exact: true }).click()
    await card.getByText("超时", { exact: true }).click()
    await card.getByText("HTTP 503", { exact: true }).click()
    await card.getByRole("button", { name: "提交回答" }).click()
    await page.clock.runFor(STEP_MS)
    await expect(page.locator(".msg-ai").last()).toContainText("只重试超时和 503")
    await expect(page.locator(".work-head")).toContainText("已工作 1 秒")
    await expect(card).toHaveCount(0)
    await page.locator(".work-toggle").click()
    await page.locator(".tool-row-head", { hasText: "已询问" }).click()
    await expect(page.locator(".ask-answer").last()).toHaveText("超时, HTTP 503")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-question-answered-${theme}.png`, options)
  })
}
