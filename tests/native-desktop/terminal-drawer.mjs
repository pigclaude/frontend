// 在真实 Electron 窗口核对底部终端的单行栏、尺寸、标签与进程生命周期。
import { basename, join } from "node:path"
import { expect } from "@playwright/test"

/** 从聊天打开底部终端，验证拖动、键盘导航和收起后保留 shell。 */
export async function verifyTerminalDrawer(page, root, output) {
  const toggle = page.getByRole("button", { name: "切换底部终端", exact: true })
  const drawer = page.getByRole("region", { name: "底部终端" })
  const name = basename(root)
  const add = drawer.getByRole("button", { name: "新建终端", exact: true })
  const first = drawer.getByRole("tab", { name, exact: true })
  const second = drawer.getByRole("tab", { name: name + " (2)", exact: true })
  const terminal = drawer.locator('[data-testid="terminal-view"]:visible')
  const readTerminal = () => terminal.evaluate((element) => element.pigcodeTerminal?.text() ?? "")
  const openDrawer = async () => {
    await expect(toggle).toHaveCount(1)
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    await toggle.click()
  }

  await openDrawer()
  await expect(terminal).toBeVisible()
  await expect(add, "底部终端只有标题栏提供新建按钮").toHaveCount(1)
  await expect(drawer.locator(".terminal-drawer-shell")).toHaveText(/\S/)
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect(first).toHaveAttribute("aria-controls", /^terminal-pane-/)

  const separator = drawer.getByRole("separator", { name: "底部终端" })
  const getHeight = () => drawer.evaluate((element) => element.getBoundingClientRect().height)
  const initial = await getHeight()
  await separator.press("ArrowUp")
  await expect.poll(getHeight).toBeGreaterThan(initial)
  const keyboardHeight = await getHeight()
  const handle = await separator.boundingBox()
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y - 45, { steps: 5 })
  await page.mouse.up()
  await expect.poll(getHeight).toBeGreaterThan(keyboardHeight + 25)
  await separator.dblclick()
  await expect.poll(getHeight).toBeCloseTo(initial, 0)

  await terminal.locator("textarea").focus()
  await page.keyboard.type("echo DRAWER_KEEP_OK")
  await page.keyboard.press("Enter")
  await expect.poll(readTerminal).toMatch(/\nDRAWER_KEEP_OK(?:\n|$)/)
  await add.click()
  await expect(second).toHaveAttribute("aria-selected", "true")
  await expect(second.getByText("(2)", { exact: true })).toBeVisible()
  await second.press("ArrowLeft")
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect(first).toBeFocused()
  await expect.poll(readTerminal).toContain("DRAWER_KEEP_OK")
  await page.screenshot({ path: join(output, "workbench-terminal-drawer.png") })

  await drawer.getByRole("button", { name: "关闭终端面板", exact: true }).click()
  await expect(drawer).toBeHidden()
  await openDrawer()
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect.poll(readTerminal).toContain("DRAWER_KEEP_OK")
  await drawer.getByRole("button", { name: "关闭 " + name + " (2)", exact: true }).click()
  await terminal.locator("textarea").focus()
  await page.keyboard.type("exit")
  await page.keyboard.press("Enter")
  await expect(drawer).toBeHidden()
  await openDrawer()
  await expect(first).toHaveAttribute("aria-selected", "true")
  await expect(drawer.locator(".terminal-drawer-shell")).toHaveText(/\S/)
  await drawer.getByRole("button", { name: "关闭 " + name, exact: true }).click()
  await expect(drawer).toBeHidden()
  console.log("PASS terminal drawer layout, resize, keyboard tabs and shell lifetime")
}
