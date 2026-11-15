// 用假的系统托盘验证基础菜单经过应用的窗口唤回和退出入口。

import type { MenuItemConstructorOptions } from "electron"
import { expect, it, vi } from "vitest"
import { createDesktopTray } from "./desktop-tray"

const electron = vi.hoisted(() => ({
  beforeQuit: vi.fn(),
  template: [] as MenuItemConstructorOptions[],
}))

vi.mock("electron", () => ({
  app: { quit: electron.beforeQuit },
  nativeImage: { createFromDataURL: () => ({ setTemplateImage() {} }) },
  Tray: class {
    setToolTip() {}
    on() {}
    setContextMenu() {}
    destroy() {}
  },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      electron.template = template
      return {}
    },
  },
}))

it("打开窗口与退出分别调用原有的唤回和退出流程", () => {
  const show = vi.fn()
  expect(createDesktopTray(show)).not.toBeNull()
  const open = electron.template.find((item) => item.id === "open-window")
  const quit = electron.template.find((item) => item.id === "quit")
  expect(open).toMatchObject({ label: "打开窗口", click: show })
  expect(quit).toMatchObject({ label: "退出", click: expect.any(Function) })
  // 这里只测试菜单行为，回调不读取菜单项、窗口或键盘事件。
  Reflect.apply(quit?.click ?? (() => undefined), undefined, [])
  expect(electron.beforeQuit).toHaveBeenCalledOnce()
})
