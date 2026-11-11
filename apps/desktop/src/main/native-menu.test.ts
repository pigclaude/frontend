// 验证标题栏菜单的输入校验、模板生成与弹出后的返回值。
import type { BrowserWindow, MenuItemConstructorOptions } from "electron"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  menuTemplate,
  popupNativeMenu,
  readMenuPosition,
  readNativeMenu,
  type MenuFactory,
} from "./native-menu"

afterEach(() => {
  vi.useRealTimers()
})

describe("readNativeMenu", () => {
  it("接受应用命令、系统角色和分隔线", () => {
    expect(
      readNativeMenu(
        [
          { id: "new-thread", label: "新会话", accelerator: "CmdOrCtrl+N" },
          { id: "palette", label: "命令面板", accelerator: "CmdOrCtrl+K", enabled: false },
          { type: "separator" },
          { role: "copy", label: "复制" },
          { role: "quit" },
        ],
        { allowDevRoles: true },
      ),
    ).toEqual([
      { id: "new-thread", label: "新会话", accelerator: "CmdOrCtrl+N" },
      { id: "palette", label: "命令面板", accelerator: "CmdOrCtrl+K", enabled: false },
      { type: "separator" },
      { role: "copy", label: "复制" },
      { role: "quit" },
    ])
  })

  it("拒绝未登记的角色、不合法的文字和快捷键", () => {
    const options = { allowDevRoles: true }
    expect(readNativeMenu([{ role: "help" }], options)).toBeNull()
    expect(readNativeMenu([{ id: "", label: "空" }], options)).toBeNull()
    expect(readNativeMenu([{ id: "x", label: 3 }], options)).toBeNull()
    expect(
      readNativeMenu([{ id: "x", label: "x", accelerator: "Ctrl+<script>" }], options),
    ).toBeNull()
    expect(readNativeMenu([{ role: "copy", label: "" }], options)).toBeNull()
    expect(readNativeMenu("menu", options)).toBeNull()
    expect(readNativeMenu([], options)).toBeNull()
    expect(
      readNativeMenu(
        Array.from({ length: 49 }, () => ({ role: "copy" })),
        options,
      ),
    ).toBeNull()
  })

  it("打包后去掉开发角色并整理分隔线", () => {
    expect(
      readNativeMenu(
        [
          { role: "zoomIn" },
          { type: "separator" },
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
        ],
        { allowDevRoles: false },
      ),
    ).toEqual([{ role: "zoomIn" }])
    expect(readNativeMenu([{ role: "reload" }], { allowDevRoles: false })).toBeNull()
  })
})

describe("readMenuPosition", () => {
  it("接受有限的坐标并把负数夹到 0", () => {
    expect(readMenuPosition({ x: 12.5, y: -3 })).toEqual({ x: 12.5, y: 0 })
    expect(readMenuPosition({ x: Number.NaN, y: 1 })).toBeNull()
    expect(readMenuPosition({ x: "1", y: 1 })).toBeNull()
    expect(readMenuPosition(null)).toBeNull()
  })
})

describe("menuTemplate", () => {
  it("应用命令的快捷键只显示不注册", () => {
    const onCommand = vi.fn()
    const [command, separator, role] = menuTemplate(
      [
        { id: "settings", label: "设置", accelerator: "CmdOrCtrl+," },
        { type: "separator" },
        { role: "undo", label: "撤销" },
      ],
      onCommand,
    )
    expect(command).toMatchObject({
      label: "设置",
      accelerator: "CmdOrCtrl+,",
      registerAccelerator: false,
      enabled: true,
    })
    expect(separator).toEqual({ type: "separator" })
    expect(role).toEqual({ role: "undo", label: "撤销" })
    ;(command?.click as () => void)()
    expect(onCommand).toHaveBeenCalledWith("settings")
  })
})

/** 记录模板与弹出参数的菜单替身；由测试决定何时点击、何时关闭。 */
function fakeFactory() {
  const state: {
    template: MenuItemConstructorOptions[]
    popup: { x: number; y: number; callback: () => void } | null
  } = { template: [], popup: null }
  const factory: MenuFactory = {
    buildFromTemplate(template) {
      state.template = template
      return {
        popup(options) {
          state.popup = options
        },
      }
    },
  }
  const click = (index: number) => (state.template[index]?.click as () => void)()
  return { state, factory, click }
}

describe("popupNativeMenu", () => {
  const window = {} as BrowserWindow
  const items = [
    { id: "new-thread", label: "新会话" },
    { id: "settings", label: "设置" },
  ]

  it("在取整后的位置弹出，并返回被点击的命令", async () => {
    const { state, factory, click } = fakeFactory()
    const result = popupNativeMenu(factory, window, items, { x: 10.4, y: 35.6 })
    expect(state.popup).toMatchObject({ x: 10, y: 36 })
    click(1)
    state.popup?.callback()
    await expect(result).resolves.toBe("settings")
  })

  it("没选命令就关闭时返回 null", async () => {
    vi.useFakeTimers()
    const { state, factory } = fakeFactory()
    const result = popupNativeMenu(factory, window, items, { x: 0, y: 0 })
    state.popup?.callback()
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBeNull()
  })

  it("菜单关闭后紧接着到达的点击仍然算数", async () => {
    vi.useFakeTimers()
    const { state, factory, click } = fakeFactory()
    const result = popupNativeMenu(factory, window, items, { x: 0, y: 0 })
    state.popup?.callback()
    click(0)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe("new-thread")
  })
})
