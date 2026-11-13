// 核对系统标题栏、原生菜单和窗口管理器响应，使用系统输入而不是页面事件。
import assert from "node:assert/strict"
import { join } from "node:path"
import { expect } from "@playwright/test"
import { systemInput } from "./system-pointer.mjs"

/** 拖动原生窗口、操作系统按钮并用原生菜单导航。 */
export async function verifySystemControls(application, page, nativeState, out) {
  const initial = await nativeState()
  const overlay = await page.evaluate(() => {
    const geometry = navigator.windowControlsOverlay.getTitlebarAreaRect()
    return { left: geometry.left, right: geometry.right, width: innerWidth }
  })
  const content = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  )
  const physical = (value) => value * (process.platform === "win32" ? initial.scale : 1)
  const point = (x, y) => [physical(content.x + x), physical(content.y + y)]
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setAlwaysOnTop(true)
    window.focus()
  })
  await systemInput("capture", join(out, "native-desktop.png"))
  const drag = point(Math.min(470, overlay.right - 40), 17)
  await systemInput("drag", ...drag, drag[0] + 60, drag[1] + 40)
  await expect
    .poll(
      async () => {
        const { bounds } = await nativeState()
        return Math.abs(bounds.x - initial.bounds.x) + Math.abs(bounds.y - initial.bounds.y)
      },
      { message: "原生标题栏空白区拖动后窗口应移动" },
    )
    .toBeGreaterThan(25)
  await application.evaluate(
    ({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds),
    initial.bounds,
  )

  const help = await page
    .locator(".titlebar")
    .getByRole("button", { name: "帮助", exact: true })
    .boundingBox()
  assert.ok(help)
  await systemInput("click", ...point(help.x + help.width / 2, help.y + help.height / 2))
  await expect(
    page.locator(".titlebar").getByRole("button", { name: "帮助", exact: true }),
  ).toHaveAttribute("aria-expanded", "true")
  await systemInput("capture", join(out, "native-menu.png"))
  await systemInput("key", "Down")
  await systemInput("key", "Return")
  await expect(page.locator('[data-main-window][data-screen="about"]')).toBeVisible()
  await systemInput("back", ...point(500, 130))
  await expect(page.locator('[data-main-window][data-screen="chat"]')).toBeVisible()
  await systemInput("forward", ...point(500, 130))
  await expect(page.locator('[data-main-window][data-screen="about"]')).toBeVisible()
  await systemInput("back", ...point(500, 130))
  await expect(page.locator('[data-main-window][data-screen="chat"]')).toBeVisible()

  const reserveLeft = overlay.left > overlay.width - overlay.right
  const reserved = reserveLeft ? overlay.left : overlay.width - overlay.right
  const button = reserved / 3
  const offset = reserveLeft ? 0 : overlay.right
  const minimizeX = offset + button * (reserveLeft ? 2.5 : 0.5)
  await systemInput("click", ...point(minimizeX, 17))
  await expect
    .poll(async () => (await nativeState()).minimized, { message: "原生最小化按钮" })
    .toBe(true)
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.restore()
    window.focus()
  })
  await systemInput("click", ...point(offset + button * 1.5, 17))
  await expect
    .poll(async () => (await nativeState()).maximized, { message: "原生最大化按钮" })
    .toBe(true)
  const maximized = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getContentBounds(),
  )
  const maxOverlay = await page.evaluate(() => {
    const rect = navigator.windowControlsOverlay.getTitlebarAreaRect()
    return { left: rect.left, right: rect.right, width: innerWidth }
  })
  const maxReserve = reserveLeft ? maxOverlay.left : maxOverlay.width - maxOverlay.right
  const maxCenter = (reserveLeft ? 0 : maxOverlay.right) + maxReserve / 2
  await systemInput("click", physical(maximized.x + maxCenter), physical(maximized.y + 17))
  await expect
    .poll(async () => (await nativeState()).maximized, { message: "原生还原按钮" })
    .toBe(false)
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setAlwaysOnTop(false),
  )
}

/** 点击系统标题栏关闭按钮，并等待窗口关闭。 */
export async function closeFromTitleBar(application, page) {
  const window = await application.evaluate(({ BrowserWindow, screen }) => ({
    bounds: BrowserWindow.getAllWindows()[0].getContentBounds(),
    scale: screen.getPrimaryDisplay().scaleFactor,
  }))
  const x = await page.evaluate(() => {
    const rect = navigator.windowControlsOverlay.getTitlebarAreaRect()
    const right = innerWidth - rect.right
    return rect.left > right ? rect.left / 6 : innerWidth - right / 6
  })
  const scale = process.platform === "win32" ? window.scale : 1
  const closed = page.waitForEvent("close", { timeout: 10_000 })
  await systemInput("click", (window.bounds.x + x) * scale, (window.bounds.y + 17) * scale)
  await closed
}
