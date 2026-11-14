// 负责顶栏更新中心的截图：只有 PigClaude 这一行，分别在下载中和下载失败时打开浮层，浅色和深色各一张。
import { expect, test } from "@playwright/test"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const
const FIXED_TIME = new Date(2026, 9, 26, 15, 0, 0).getTime()

const available: DesktopUpdateState = {
  autoCheck: true,
  phase: "available",
  currentVersion: "0.1.0",
  version: "0.2.0",
  url: "https://github.com/pigclaude/release/releases/tag/v0.2.0",
  action: "download",
  progress: null,
  error: null,
}
const states = {
  downloading: { ...available, phase: "downloading", progress: 42 },
  failed: { ...available, phase: "failed", error: "download" },
} satisfies Record<string, DesktopUpdateState>

for (const [name, state] of Object.entries(states)) {
  for (const theme of ["light", "dark"] as const) {
    test(`update center ${name} ${theme}`, async ({ page }) => {
      await page.clock.install({ time: FIXED_TIME })
      await page.addInitScript((update) => {
        window.pigclaude = {
          platform: "darwin",
          updates: {
            state: async () => update,
            perform: async () => update,
            check: async () => ({ status: "update-available", version: update.version ?? "" }),
            setAutoCheck: async () => update,
            openReleaseNotes: async () => undefined,
            subscribe: () => () => undefined,
          },
        }
      }, state)
      await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
      await page.getByRole("button", { name: "查看更新", exact: true }).click()
      const popup = page.locator(".update-center-popup")
      await expect(popup.locator(".update-center-name")).toHaveText("PigClaude")
      await page.evaluate(() => document.fonts.ready)
      await page.addStyleTag({
        content: "*, *::before, *::after { caret-color: transparent !important }",
      })
      await expect(page).toHaveScreenshot(`update-center-${name}-${theme}.png`, options)
    })
  }
}
