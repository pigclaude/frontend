// 负责新会话草稿分支与 worktree 控件的视觉回归：项目在 main 分支上，截草稿、打开的分支菜单、
// 打开 worktree 开关后选起点的菜单，浅色和深色各一套。
// 页面加载前装一个只在内存里的桌面桥：一个最近工作区、一个账号、读得到分支的工作台和一个不会开始的会话。
import { expect, test, type Locator, type Page } from "@playwright/test"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

/** 新会话页按时段问候；把时钟定在基线时刻，截图不受运行时间影响。 */
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

async function openDraft(page: Page, theme: "light" | "dark", git = true): Promise<void> {
  await page.clock.install({ time: FIXED_TIME })
  await page.addInitScript((git) => {
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
    const branches = {
      currentBranch: "main",
      head: "4f2c9e1a7b3d5f60812c4e9a0b7d6c5e3f2a1b09",
      localBranches: ["feature/search", "fix/greeting", "main"],
      remoteBranches: ["origin/feature/search", "origin/main"],
    }
    const lists = new Set(["worktrees", "checkpoints", "editors"])
    const workbench = new Proxy(
      {},
      {
        get: (_target, name) => {
          if (name === "subscribe") return () => () => undefined
          if (name === "branches") return async () => (git ? branches : null)
          if (typeof name === "string" && lists.has(name)) return async () => []
          return async () => null
        },
      },
    )
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
          list: async () => ["/Users/me/work/demo-app"],
          add: async () => ["/Users/me/work/demo-app"],
          files: async () => [],
          names: async () => ({}),
          rename: async () => ({}),
          remove: async () => [],
          reveal: async () => undefined,
          apps: async () => [],
          openWith: async () => undefined,
        },
        workbench,
        session: {
          start: reject,
          send: reject,
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
          subscribe: () => () => undefined,
        },
      },
    })
  }, git)
  await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: "*, *::before, *::after { caret-color: transparent !important }",
  })
  await expect(page.getByRole("button", { name: "会话所在的项目: demo-app" })).toBeVisible()
  if (git) await expect(page.getByRole("button", { name: "切换 Git 分支 · main" })).toBeVisible()
}

async function bounds(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error("控件没有可见边界")
  return box
}

test("普通目录保留 worktree 入口并说明启用条件", async ({ page }) => {
  await openDraft(page, "light", false)
  const worktree = page.getByRole("switch", { name: "worktree" })
  await expect(worktree).toBeVisible({ timeout: 3000 })
  await expect(worktree).toBeDisabled()
  await expect(worktree).toHaveAccessibleDescription("请添加并选择一个 Git 仓库来使用 worktree。")
})

test("新会话项目栏在宽窄窗口里与输入框和发送按钮对齐", async ({ page }) => {
  await openDraft(page, "light")
  const project = page.locator(".new-thread-view .draft-project")
  const branch = page.locator(".new-thread-view .draft-branch")
  const worktree = page.locator(".draft-worktree [role='switch']")
  const wrapper = page.locator(".composer-frame")
  const editor = page.locator(".composer-editor .tiptap p")
  const send = page.getByRole("button", { name: "发送" })

  for (const width of [1200, 620, 390]) {
    await page.setViewportSize({ width, height: 800 })
    const [frameBox, projectBox, branchBox, switchBox, editorBox, sendBox] = await Promise.all([
      bounds(wrapper),
      bounds(project.locator("svg").first()),
      bounds(branch.locator("svg").first()),
      bounds(worktree),
      bounds(editor),
      bounds(send),
    ])
    expect(Math.abs(projectBox.x - editorBox.x), "项目图标与输入文字左侧").toBeLessThan(1)
    expect(
      Math.abs(switchBox.x + switchBox.width - sendBox.x - sendBox.width),
      "worktree 开关与发送按钮右侧",
    ).toBeLessThan(1)
    expect(
      Math.abs(projectBox.y + projectBox.height / 2 - switchBox.y - switchBox.height / 2),
      "项目与 worktree 在同一行",
    ).toBeLessThan(1)
    if (frameBox.width <= 380) {
      expect(Math.abs(branchBox.x - projectBox.x), "折行后的分支与项目左侧").toBeLessThan(1)
      expect(branchBox.y).toBeGreaterThan(projectBox.y + projectBox.height)
    } else {
      expect(Math.abs(branchBox.y - projectBox.y), "分支与项目在同一行").toBeLessThan(1)
    }
  }
})

for (const theme of ["light", "dark"] as const) {
  test(`draft branches ${theme}`, async ({ page }) => {
    await openDraft(page, theme)
    await expect(page).toHaveScreenshot(`draft-branches-${theme}.png`, options)

    await page.getByRole("button", { name: "切换 Git 分支 · main" }).click()
    await expect(page.getByRole("option", { name: "feature/search" })).toBeVisible()
    await expect(page).toHaveScreenshot(`draft-branches-menu-${theme}.png`, options)
    await page.keyboard.press("Escape")
    await expect(page.locator(".draft-branch-menu")).toHaveCount(0)

    await page.locator(".draft-worktree [role='switch']").click()
    await page.getByRole("button", { name: "选择 worktree 起点 · main" }).click()
    await expect(page.getByRole("option", { name: "origin/main" })).toBeVisible()
    await expect(page).toHaveScreenshot(`draft-branches-worktree-${theme}.png`, options)
  })
}
