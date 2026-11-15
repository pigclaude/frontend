// 在真实桌面页面验证浏览器的单次审批卡和窄工具栏。桌面桥只回放合成会话与工作台事件。
import { expect, test, type Page } from "@playwright/test"
import type { AgentBrowserTab, WorkbenchEvent } from "../src/workbench-contract"
import { installChatBridge, type ChatBridgeWindow } from "./chat-bridge"

const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const
const localUrl = "http://localhost:4173/settings?view=compact#email"
const clickedName = "保存偏好设置"

type BrowserFixtureWindow = ChatBridgeWindow & {
  openWorkbenchBrowser: () => string
  emitWorkbench: (event: WorkbenchEvent) => void
}

async function installBrowserFixture(page: Page): Promise<void> {
  await installChatBridge(page)
  await page.addInitScript(
    ({ url, name }) => {
      window.localStorage.setItem("pigclaude.rightWidth", "340")
      const { install, emit } = (window as unknown as ChatBridgeWindow).__chatBridge
      const listeners = new Set<(event: WorkbenchEvent) => void>()
      let opened: AgentBrowserTab | null = null
      let activeSession: string | null = null
      const emitWorkbench = (event: WorkbenchEvent) =>
        listeners.forEach((listener) => listener(event))
      install({
        send: async () => {
          emit({ type: "turn-started", turnId: "turn-1" })
          emit({
            type: "permission",
            requestId: "browser-fixture",
            toolName: "mcp__pigclaude_workbench__browser_click",
            input: { ref: "e7" },
            subagent: null,
            defaultToNo: true,
            browser: { kind: "click", url, ref: "e7", role: "button", name },
          })
        },
      })
      Object.assign(window.pigclaude ?? {}, {
        workbench: {
          reportUnsaved: async () => undefined,
          browserPresent: async () => undefined,
          browserClose: async () => undefined,
          browserSetActiveSession: async (sessionId: string | null) => {
            activeSession = sessionId
          },
          browserListAgentTabs: async (scope: string) =>
            opened?.sessionId === scope ? [opened] : [],
          subscribe(listener: (event: WorkbenchEvent) => void) {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        },
      })
      Object.assign(window, {
        openWorkbenchBrowser: () => {
          if (activeSession === null) throw new Error("工作台尚未绑定当前会话")
          const sessionId = activeSession
          const id = "browser-fixture"
          opened = {
            id,
            sessionId,
            page: { url, title: "", loading: false, canGoBack: false, canGoForward: false },
          }
          emitWorkbench({ type: "browser-open", id, sessionId, url })
          return sessionId
        },
        emitWorkbench,
      })
    },
    { url: localUrl, name: clickedName },
  )
}

for (const theme of ["light", "dark"] as const) {
  test(`browser approval and activity ${theme}`, async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 26, 15, 0, 0) })
    await installBrowserFixture(page)
    await page.goto(`/?screen=chat-new&theme=${theme}&glass=0`)
    await page.evaluate(() => document.fonts.ready)

    const editor = page.locator(".composer .tiptap")
    await editor.fill("检查本机设置页")
    await editor.press("Enter")
    const prompt = page.getByRole("dialog", { name: "需要权限" })
    await expect(prompt).toContainText(localUrl)
    await expect(prompt).toContainText(clickedName)
    await expect(prompt.getByRole("option")).toHaveCount(2)
    await expect(prompt).toHaveScreenshot(`browser-click-approval-${theme}.png`, options)
    await prompt.getByRole("option", { name: /允许一次/ }).press("Enter")
    await expect(prompt).toHaveCount(0)

    await page.getByRole("button", { name: "切换右侧面板", exact: true }).click()
    const panel = page.locator(".right-panel-slot .workbench")
    await expect(panel).toBeVisible()
    const sessionId = await page.evaluate(() =>
      (window as unknown as BrowserFixtureWindow).openWorkbenchBrowser(),
    )

    const toolbar = panel.locator(".browser-toolbar")
    await expect(toolbar.locator("input")).toHaveValue(localUrl)
    await expect(toolbar.getByRole("status")).toHaveCount(0)
    await page.evaluate(
      ({ url, name, sessionId }) =>
        (window as unknown as BrowserFixtureWindow).emitWorkbench({
          type: "browser-page",
          id: "browser-fixture",
          sessionId,
          page: {
            url,
            title: "设置",
            loading: false,
            canGoBack: true,
            canGoForward: false,
            activity: { kind: "click", target: name },
          },
        }),
      { url: localUrl, name: clickedName, sessionId },
    )

    await expect(toolbar.getByRole("status")).toHaveText(`Agent · 点击 · ${clickedName}`)
    await expect(toolbar.getByRole("button", { name: "后退", exact: true })).toBeEnabled()
    await page.mouse.move(20, 760)
    await expect(toolbar).toHaveScreenshot(`browser-agent-toolbar-${theme}.png`, options)
  })
}
