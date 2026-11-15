// 核对系统标题栏、原生菜单和窗口管理器响应，使用系统输入而不是页面事件。
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

/** 验证关窗隐藏同一个原生窗口，Dock 激活或再次启动能唤回，再保存关窗退出偏好。 */
export async function verifyBackgroundClose(application, page) {
  const defaultValue = await page.evaluate(() => window.pigclaude.window.getCloseToTray())
  assert.equal(defaultValue, process.platform !== "linux")
  if (!defaultValue)
    assert.equal(await page.evaluate(() => window.pigclaude.window.setCloseToTray(true)), true)
  const read = () =>
    application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return window ? { id: window.id, visible: window.isVisible() } : null
    })
  const original = await read()
  assert.ok(original?.visible)
  await page.evaluate(() => window.pigclaude.window.control("close"))
  await expect.poll(read, { message: "关窗后仍保留原生窗口" }).toEqual({
    id: original.id,
    visible: false,
  })
  await application.evaluate(({ app }) => {
    if (process.platform === "darwin") app.emit("activate")
    else app.emit("second-instance", {}, [], process.cwd())
  })
  await expect.poll(read, { message: "唤回相同窗口" }).toEqual(original)
  assert.equal(await page.evaluate(() => window.pigclaude.window.setCloseToTray(false)), false)
}

/** 点击系统关闭按钮，由主进程的 closed 事件确认原生窗口已销毁。 */
export async function verifySystemClose(application, page, out) {
  const eventFile = join(out, "native-window-closed.txt")
  const { bounds, scale } = await application.evaluate(({ BrowserWindow, screen }, path) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())
    if (!window) throw new Error("缺少可见主窗口")
    window.setAlwaysOnTop(true)
    window.focus()
    window.once("closed", () => process.getBuiltinModule("node:fs").writeFileSync(path, "closed"))
    return { bounds: window.getContentBounds(), scale: screen.getPrimaryDisplay().scaleFactor }
  }, eventFile)
  const { x, y, visible } = await page.evaluate(() => {
    const overlay = navigator.windowControlsOverlay
    const rect = overlay.getTitlebarAreaRect()
    const right = innerWidth - rect.right
    return {
      x: rect.left > right ? rect.left / 6 : innerWidth - right / 6,
      y: rect.height / 2,
      visible: overlay.visible,
    }
  })
  assert.equal(visible, true)
  await systemInput("capture", join(out, "native-before-close.png"))
  const factor = process.platform === "win32" ? scale : 1
  await systemInput("click", (bounds.x + x) * factor, (bounds.y + y) * factor)
  await expect
    .poll(async () => readFile(eventFile, "utf8").catch(() => null), {
      message: "原生关闭按钮应触发 BrowserWindow 的 closed 事件",
      timeout: 10_000,
    })
    .toBe("closed")
}
