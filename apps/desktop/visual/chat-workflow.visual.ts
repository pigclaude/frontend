// 负责工作流卡的视觉回归：工作流运行中时卡片展开，按阶段列出各个 agent 的状态和在做的事；
// 跑完后卡片显示各 agent 的结论、耗时和用量；停止这一轮后卡片和没跑完的 agent 显示为已停止。
// 浅色和深色各一套。页面加载前装上共用的内存桌面桥，发送后按信封推送工作流的事件。
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
    const call = "call-workflow"
    const script = [
      "export const meta = {",
      "  name: 'review-two-files',",
      "  description: '每个文件派一个 agent 写一句评审',",
      "}",
      "phase('Review')",
      "await parallel([() => agent('评审 math.js'), () => agent('评审 greet.js')])",
    ].join("\n")
    const header = {
      toolCallId: call,
      taskId: "wtask-1",
      name: "review-two-files",
      description: "每个文件派一个 agent 写一句评审",
      phases: [{ index: 1, title: "Review" }],
    }
    const math = {
      index: 1,
      label: "review:math.js",
      phase: "Review",
      model: "claude-sonnet",
      prompt: "用一句话评审 src/math.js。",
    }
    const greet = {
      ...math,
      index: 2,
      label: "review:greet.js",
      prompt: "用一句话评审 src/greet.js。",
    }
    const result = (status: string) => ({
      type: "result",
      subtype: status,
      isError: false,
      durationMs: 10,
      numTurns: 1,
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    })
    const work = () => {
      emit({ type: "account-switched", from: null, to: "acc-work", reason: "initial" })
      emit({ type: "turn-started", turnId: "turn-1" })
      emit(assistant("m-1", [{ type: "tool-use", id: call, name: "Workflow", input: { script } }]))
      emit({
        type: "workflow",
        workflow: {
          toolCallId: call,
          name: header.name,
          description: header.description,
          script,
          status: "running",
          phases: [],
          agents: [],
        },
      })
      emit({
        type: "tool-result",
        toolUseId: call,
        content: "Workflow launched in background",
        isError: false,
        subagent: null,
        backgroundLaunch: true,
      })
      emit(assistant("m-2", [{ type: "text", text: "已用工作流派两个 agent 各审一个文件。" }]))
      emit(result("success"))
      emit({
        type: "workflow",
        workflow: {
          ...header,
          status: "running",
          agents: [
            { ...math, state: "running", activity: "Read src/math.js" },
            { ...greet, state: "queued" },
          ],
        },
      })
    }
    const finish = () => {
      emit({
        type: "workflow",
        workflow: {
          ...header,
          status: "completed",
          summary: 'Dynamic workflow "每个文件派一个 agent 写一句评审" completed',
          usage: { tokens: 64_398, toolCalls: 2, durationMs: 20_986 },
          agents: [
            {
              ...math,
              state: "done",
              result: "`add` 和 `sub` 都很直接，缺少对非数字参数的检查。",
              tokens: 32_100,
              toolCalls: 1,
              durationMs: 9_800,
            },
            {
              ...greet,
              state: "done",
              result: "`greet` 拼接清楚，空名字时会输出多余的逗号。",
              tokens: 32_298,
              toolCalls: 1,
              durationMs: 11_200,
            },
          ],
        },
      })
      emit(assistant("m-3", [{ type: "text", text: "两个文件都审完了，各有一处小问题。" }]))
      emit(result("success"))
      emit({ type: "turn-ended", turnId: "turn-1", status: "completed", errorCode: null })
    }
    install({
      send: async () => {
        setTimeout(work)
      },
      cancel: async () => {
        setTimeout(() =>
          emit({
            type: "turn-ended",
            turnId: "turn-1",
            status: "interrupted",
            errorCode: "SESSION_CANCELLED",
          }),
        )
      },
    })
    Object.assign(window, { __finishWorkflow: finish })
  })
  await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
  const editor = page.locator(".composer .tiptap")
  await editor.click()
  await editor.pressSequentially("派两个 agent 各审一个文件")
  await page.clock.pauseAt(SEND_AT)
  await editor.press("Enter")
  await page.clock.runFor(STEP_MS)
}

for (const theme of ["light", "dark"] as const) {
  test(`workflow running ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    const card = page.locator(".workflow-row")
    await expect(card).toHaveAttribute("data-status", "running")
    await expect(card).toContainText("Read src/math.js")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-workflow-running-${theme}.png`, options)
  })

  test(`workflow finished ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    await expect(page.locator(".workflow-row")).toContainText("Read src/math.js")
    await page.evaluate(() =>
      (window as unknown as { __finishWorkflow: () => void }).__finishWorkflow(),
    )
    await page.clock.runFor(STEP_MS)
    await expect(page.locator(".msg-ai").last()).toContainText("各有一处小问题")
    await page.locator(".work-toggle").click()
    const card = page.locator(".workflow-row")
    await expect(card).toHaveAttribute("data-status", "completed")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-workflow-finished-${theme}.png`, options)
  })

  test(`workflow stopped ${theme}`, async ({ page }) => {
    await openChat(page, theme)
    await expect(page.locator(".workflow-row")).toContainText("Read src/math.js")
    await page.getByRole("button", { name: "中断" }).click()
    await page.clock.runFor(STEP_MS)
    const card = page.locator(".workflow-row")
    await expect(card).toHaveAttribute("data-status", "stopped")
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-workflow-stopped-${theme}.png`, options)
  })
}
