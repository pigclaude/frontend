// 观察真实 Electron 托盘应用的菜单，并用原生菜单回调唤回同一个窗口。

import assert from "node:assert/strict"
import { expect } from "@playwright/test"

/** 只在验收进程记录 Tray 实际接收的 Menu，仍调用 Electron 的原生接口。 */
export async function trackNativeTray(application) {
  await application.evaluate(({ Tray }) => {
    const setContextMenu = Tray.prototype.setContextMenu
    Tray.prototype.setContextMenu = function (menu) {
      setContextMenu.call(this, menu)
      Reflect.set(globalThis, "acceptanceTrayMenu", menu)
    }
  })
}

/** 检查状态行与新会话可用性，等异步会员刷新结束。 */
export async function verifyTrayMembership(application, label, canStartSession) {
  await expect
    .poll(() =>
      application.evaluate(() => {
        const menu = Reflect.get(globalThis, "acceptanceTrayMenu")
        return {
          membership: menu?.getMenuItemById("membership")?.label ?? null,
          canStartSession: menu?.getMenuItemById("new-session")?.enabled === true,
        }
      }),
    )
    .toEqual({ membership: label, canStartSession })
}

/** 点击真正交给 Tray 的菜单项时应唤回窗口，并由 preload 打开同一个渲染层中的新草稿。 */
export async function verifyTrayNavigation(application, page) {
  await verifyTrayMembership(application, "会员有效", true)
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await expect(page.locator('[data-main-window][data-screen="general"]')).toBeVisible()
  const native = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const id = window.webContents.id
    const menu = Reflect.get(globalThis, "acceptanceTrayMenu")
    const item = menu.getMenuItemById("new-session")
    window.hide()
    const hidden = !window.isVisible()
    item.click({}, window, {})
    return { hidden, visible: window.isVisible(), retained: id === window.webContents.id }
  })
  assert.deepEqual(native, { hidden: true, visible: true, retained: true })
  await expect(page.locator('[data-main-window][data-screen="chat-new"]')).toBeVisible()
}
