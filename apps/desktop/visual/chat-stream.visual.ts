// 负责聊天时间线的视觉回归：正在写的回答带光标、上一段思考显示主进程算好的耗时；一轮结束后回答落在原位，
// 展开的工作区里思考仍显示耗时。浅色和深色各一套。
// 页面加载前装一个只在内存里的桌面桥：一个最近工作区、一个账号和一个按信封回放一轮的假会话。
import { expect, test, type Page } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

/**
 * 运行中的一轮显示「工作中」的时长。截图前把时钟停在开始后两个半小时多一点，
 * 发送到截图之间实际过去的几秒不会改变显示到分钟的时长。
 */
const RUNNING_FOR_MS = (2 * 60 * 60 + 30 * 60 + 30) * 1000

async function openChat(page: Page, theme: "light" | "dark", finish: boolean): Promise<void> {
  await page.clock.install({ time: FIXED_TIME })
  await page.addInitScript((finishTurn: boolean) => {
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
    let listener: ((envelope: unknown) => void) | null = null
    let seq = 0
    const emit = (event: { type: string }) =>
      listener?.({
        version: 1,
        sessionId: "s-1",
        seq: event.type === "delta" ? null : (seq += 1),
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
    const reply = () => {
      emit({ type: "account-switched", from: null, to: "acc-work", reason: "initial" })
      emit({ type: "turn-started", turnId: "turn-1" })
      emit(
        assistant(
          "m-1",
          [{ type: "thinking", text: "先看锁文件里各个依赖的版本，再对比最新发布。" }],
          {
            thinkingMs: 4_200,
          },
        ),
      )
      emit(
        assistant("m-1", [
          { type: "tool-use", id: "tool-1", name: "Bash", input: { command: "pnpm outdated" } },
        ]),
      )
      emit({ type: "tool-result", toolUseId: "tool-1", content: "", isError: false })
      const answer = "依赖都是最新的，锁文件和 package.json 一致"
      if (!finishTurn) {
        emit({ type: "delta", text: answer, thinking: false, blockIndex: 0 })
        return
      }
      emit(assistant("m-2", [{ type: "text", text: `${answer}。` }]))
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
            setTimeout(reply)
          },
          cancel: async () => undefined,
          respondPermission: async () => undefined,
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
  }, finish)
  await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
  const editor = page.locator(".composer .tiptap")
  await editor.click()
  await editor.pressSequentially("检查依赖")
  await editor.press("Enter")
}

for (const theme of ["light", "dark"] as const) {
  test(`streaming answer ${theme}`, async ({ page }) => {
    await openChat(page, theme, false)
    await expect(page.locator(".msg-ai.is-streaming")).toContainText("锁文件和 package.json 一致")
    await expect(page.getByText("持续了 5 秒")).toBeVisible()
    await page.clock.pauseAt(FIXED_TIME + RUNNING_FOR_MS)
    await page.clock.runFor(1_000)
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-streaming-answer-${theme}.png`, options)
  })

  test(`finished answer ${theme}`, async ({ page }) => {
    await openChat(page, theme, true)
    await expect(page.locator(".msg-ai").last()).toContainText("锁文件和 package.json 一致。")
    await page.locator(".work-toggle").click()
    await expect(page.getByText("持续了 5 秒")).toBeVisible()
    await page.mouse.move(600, 760)
    await expect(page).toHaveScreenshot(`chat-finished-answer-${theme}.png`, options)
  })
}
