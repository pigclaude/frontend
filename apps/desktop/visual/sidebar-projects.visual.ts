// 负责侧栏项目操作的视觉回归：项目右键菜单，以及新会话页头部「在应用中打开」的应用列表，浅色和深色各一套。
// 页面加载前装一个只在内存里的桌面桥：两个最近工作区、一个改过名的项目和三类本机应用。
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
          list: async () => [],
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
          add: async (path: string) => [path],
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
}
