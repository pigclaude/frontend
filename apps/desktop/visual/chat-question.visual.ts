// 负责提问卡的视觉回归：Claude 用 AskUserQuestion 提问时，提问卡显示在这一轮里（一个单选、一个多选），
// 回答后卡片换成「已询问」的历史行，展开后逐条列出问题和答案。浅色和深色各一套。
// 页面加载前装一个只在内存里的桌面桥：一个最近工作区、一个账号和一个按信封回放的假会话。
import { expect, test, type Page } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

/** 发送前把时钟停住，之后只按固定步长拨动，一轮显示的「已工作」时长不受点击快慢影响。 */
const SEND_AT = FIXED_TIME + 60_000
const STEP_MS = 1_000

async function openChat(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.clock.install({ time: FIXED_TIME })
  await page.addInitScript(() => {
    const membership = {
      startupPhase: "settled",
      revision: 1,
      state: "active",
      account: { userId: "u1", nickname: "林舟", email: "lin@example.com", avatar: "" },
      tier: null,
      membershipValidUntil: null,
      offlineValidUntil: null,
    }
    const reject = async () => {
      throw new Error("not used in the visual preview")
    }
    const account = {
      id: "acc-work",
      displayName: "工作号",
      enabled: true,
      email: null,
      subscriptionType: "max",
      needsReauth: false,
      credentialExpiresAt: 1_900_000_000_000,
      proxyId: null,
      fingerprint: {
        seed: "123456",
        brand: "Chrome",
        platform: "macos",
        lang: "en-US",
        timezone: "America/Los_Angeles",
        canvasNoise: "1",
        clientRectsNoise: "1",
      },
      createdAt: "2026-10-21T00:00:00.000Z",
      updatedAt: "2026-10-21T00:00:00.000Z",
    }
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
    let listener: ((envelope: unknown) => void) | null = null
    let seq = 0
    const emit = (event: { type: string }) =>
      listener?.({
        version: 1,
        sessionId: "s-1",
        seq: (seq += 1),
        at: new Date().toISOString(),
        event,
      })
    const assistant = (id: string, blocks: unknown[], extra: object = {}) => ({
      type: "message",
      messageId: id,
      model: "claude-sonnet",
      parentToolUseId: null,
      blocks,
      ...extra,
    })
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
    Object.assign(window, {
      pigclaude: {
        platform: "darwin",
        membership: {
          inspect: async () => membership,
          subscribe: () => () => undefined,
          withdraw: async () => membership,
          signOut: async () => membership,
        },
        claudeAccounts: {
          list: async () => [account],
          authorize: reject,
          cancelAuthorization: async () => undefined,
          update: reject,
          remove: async () => undefined,
          importFromClaudeCli: reject,
          subscribe: () => () => undefined,
        },
        proxies: {
          list: async () => [],
          save: reject,
          remove: async () => undefined,
          test: reject,
        },
        egress: { check: reject },
        workspaces: {
          list: async () => ["/Users/me/work/api"],
          add: async () => ["/Users/me/work/api"],
          files: async () => [],
          names: async () => ({}),
          rename: async () => ({}),
          remove: async () => [],
          reveal: async () => undefined,
          apps: async () => [],
          openWith: async () => undefined,
        },
        session: {
          start: async () => {
            setTimeout(() =>
              emit({
                type: "started",
                sessionId: "s-1",
                model: "claude-sonnet",
                tools: [],
                permissionMode: "default",
              }),
            )
            return { sessionId: "s-1" }
          },
          send: async () => {
            setTimeout(ask)
          },
          cancel: async () => undefined,
          respondPermission: async () => undefined,
          answerQuestion: async (input: { answers: string[] }) => {
            setTimeout(() => answer(input.answers))
          },
          setMode: async () => undefined,
          setModel: async () => undefined,
          stop: async () => undefined,
          events: async () => [],
          models: async () => ({
            models: [
              { id: "claude-sonnet", displayName: "Sonnet", description: "", isDefault: true },
            ],
            cliError: null,
          }),
          status: async () => ({
            active: false,
            sessionId: null,
            model: null,
            permissionMode: "default",
            accountId: null,
            pendingPermissions: 0,
            pendingQuestions: 0,
            turnId: null,
          }),
          subscribe: (next: (envelope: unknown) => void) => {
            listener = next
            return () => {
              listener = null
            }
          },
        },
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
