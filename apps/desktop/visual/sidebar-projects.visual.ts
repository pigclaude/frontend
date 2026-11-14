// 负责侧栏项目操作的视觉回归：项目右键菜单、新会话页头部「在应用中打开」的应用列表，
// 以及跑完一轮的会话行（已完成状态点和账号角标），浅色和深色各一套。
// 页面加载前装一个只在内存里的桌面桥：两个最近工作区、一个改过名的项目、三类本机应用和一个假会话。
import { expect, test, type Page } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

async function openDraft(page: Page, theme: "light" | "dark"): Promise<void> {
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
    let listener: ((envelope: unknown) => void) | null = null
    let seq = 0
    const emit = (event: unknown) =>
      listener?.({
        version: 1,
        sessionId: "s-1",
        seq: (seq += 1),
        at: new Date().toISOString(),
        event,
      })
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
          list: async () => ["/Users/me/work/api", "/Users/me/work/web"],
          add: async () => ["/Users/me/work/api", "/Users/me/work/web"],
          files: async () => [],
          names: async () => ({ "/Users/me/work/api": "后端服务" }),
          rename: async () => ({}),
          remove: async () => [],
          reveal: async () => undefined,
          apps: async () => [
            { id: "finder", name: "Finder", kind: "file-manager" },
            { id: "cursor", name: "Cursor", kind: "editor" },
            { id: "vscode", name: "VS Code", kind: "editor" },
            { id: "terminal", name: "Terminal", kind: "terminal" },
            { id: "ghostty", name: "Ghostty", kind: "terminal" },
          ],
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
            setTimeout(() => {
              emit({ type: "account-switched", from: null, to: "acc-work", reason: "initial" })
              emit({ type: "turn-started", turnId: "turn-1" })
              emit({
                type: "message",
                messageId: "m-1",
                model: "claude-sonnet",
                parentToolUseId: null,
                blocks: [{ type: "text", text: "依赖都是最新的。" }],
              })
              emit({
                type: "result",
                subtype: "success",
                isError: false,
                durationMs: 10,
                numTurns: 1,
                stopReason: "end_turn",
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  cacheReadTokens: 0,
                  cacheCreationTokens: 0,
                },
              })
              emit({ type: "turn-ended", turnId: "turn-1", status: "completed", errorCode: null })
            })
          },
          cancel: async () => undefined,
          respondPermission: async () => undefined,
          setMode: async () => undefined,
          setModel: async () => undefined,
          stop: async () => undefined,
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
          subscribe: (next: (event: unknown) => void) => {
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
}

for (const theme of ["light", "dark"] as const) {
  test(`sidebar project menu ${theme}`, async ({ page }) => {
    await openDraft(page, theme)
    await page.getByRole("button", { name: "后端服务", exact: true }).click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "从侧栏移除" })).toBeVisible()
    await expect(page).toHaveScreenshot(`sidebar-project-menu-${theme}.png`, options)
  })

  test(`open project in app ${theme}`, async ({ page }) => {
    await openDraft(page, theme)
    await page.getByRole("button", { name: "选择打开方式", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: "Ghostty" })).toBeVisible()
    await expect(page).toHaveScreenshot(`open-project-in-app-${theme}.png`, options)
  })
  test(`finished session row ${theme}`, async ({ page }) => {
    await openDraft(page, theme)
    const editor = page.locator(".composer .tiptap")
    await editor.click()
    await editor.pressSequentially("检查依赖")
    await editor.press("Enter")
    await expect(page.locator('.proj-sessions .sess[data-status="completed"]')).toBeVisible()
    await expect(page.locator(".proj-sessions .agent-icon-badge")).toBeVisible()
    await page.mouse.move(600, 400)
    await expect(page.locator("aside.sidebar")).toHaveScreenshot(
      `sidebar-session-row-${theme}.png`,
      options,
    )
  })
}
