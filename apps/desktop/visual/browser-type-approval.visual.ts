// 验证真实桌面审批卡的密码掩码和原生键盘显隐；会话桥只推送合成请求。
import { expect, test } from "@playwright/test"
import { installChatBridge, type ChatBridgeWindow } from "./chat-bridge"

const fixtureText = "fixture-17"
const options = { threshold: 0.1, maxDiffPixels: 0, animations: "disabled" } as const

test("browser password approval is masked and can be inspected by keyboard", async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 26, 15, 0, 0) })
  await installChatBridge(page)
  await page.addInitScript((text) => {
    const { install, emit } = (window as unknown as ChatBridgeWindow).__chatBridge
    install({
      send: async () => {
        emit({ type: "turn-started", turnId: "type-fixture-turn" })
        emit({
          type: "permission",
          requestId: "type-fixture-permission",
          toolName: "mcp__pigclaude_workbench__browser_type",
          input: { text },
          subagent: null,
          defaultToNo: true,
          browser: {
            kind: "type",
            url: "http://localhost:4173/settings",
            ref: "e4",
            role: "textbox",
            name: "访问密码",
            isPassword: true,
            characterCount: 10,
            clear: true,
            submit: false,
          },
        })
      },
    })
  }, fixtureText)

  await page.goto("/?screen=chat-new&theme=dark&glass=0")
  await page.evaluate(() => document.fonts.ready)
  const editor = page.locator(".composer .tiptap")
  await editor.fill("检查本机表单")
  await editor.press("Enter")

  const prompt = page.getByRole("dialog", { name: "需要权限" })
  const inputText = prompt.locator("pre")
  const reveal = prompt.getByRole("button", { name: "显示密码" })
  const hide = prompt.getByRole("button", { name: "隐藏密码" })
  await expect(prompt).toContainText("10 个字符")
  await expect(prompt.getByRole("option")).toHaveCount(2)
  await expect(prompt.getByRole("option", { name: /拒绝/ })).toBeFocused()
  await expect(inputText).toHaveText("[已打码]")
  expect(await prompt.evaluate((element) => element.outerHTML)).not.toContain(fixtureText)

  await page.keyboard.press("Shift+Tab")
  await expect(reveal).toBeFocused()
  await page.keyboard.press("Space")
  await expect(hide).toBeFocused()
  await expect(inputText).toHaveText(fixtureText)
  await page.keyboard.press("Enter")
  await expect(reveal).toBeFocused()
  await expect(inputText).toHaveText("[已打码]")
  expect(await prompt.evaluate((element) => element.outerHTML)).not.toContain(fixtureText)

  await page.mouse.move(20, 760)
  await expect(prompt).toHaveScreenshot("browser-type-approval-masked-dark.png", options)
})
