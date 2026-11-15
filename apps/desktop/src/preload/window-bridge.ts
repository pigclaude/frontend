// 负责向页面暴露外壳需要的窗口能力：窗口按钮、最大化与全屏状态、标题栏菜单、标题栏配色和侧栏透明。
// 全部走 pigclaude:* 通道，主进程只作用于发消息的受信任窗口。
import { ipcRenderer } from "electron"
import type { WindowNavigationCommand } from "../window-navigation-contract"
import { windowNavigationListener } from "./window-navigation"

/** 标题栏菜单里可以序列化的一项：分隔线、应用命令或系统角色。 */
export type NativeMenuItemInput =
  | { type: "separator" }
  | { id: string; label: string; accelerator?: string; enabled?: boolean }
  | { role: string; label?: string }

/** 外壳使用的窗口能力。 */
export type WindowBridge = {
  control: (action: "minimize" | "maximize" | "close") => Promise<void>
  /** 读取窗口关闭时是否隐藏到托盘。 */
  getCloseToTray: () => Promise<boolean>
  /** 保存窗口关闭行为，返回落盘的值。 */
  setCloseToTray: (value: boolean) => Promise<boolean>
  /** 订阅托盘或系统通知的导航命令，调用返回值取消订阅。 */
  onNavigation: (listener: (command: WindowNavigationCommand) => void) => () => void
  isMaximized: () => Promise<boolean>
  isFullScreen: () => Promise<boolean>
  /** 订阅全屏变化；返回取消订阅函数。 */
  onFullScreenChange: (listener: (fullScreen: boolean) => void) => () => void
  setTitleBarColors: (colors: { color: string; symbolColor: string }) => Promise<void>
  setTranslucent: (translucent: boolean) => Promise<void>
  /** 弹出原生菜单；返回被点击的命令 id，没有选择时为 null。 */
  popupMenu: (
    items: readonly NativeMenuItemInput[],
    position: { x: number; y: number },
  ) => Promise<string | null>
}

/** 创建窗口能力的公开桥；返回值都在页面这一侧收窄成约定的类型。 */
export function windowBridge(): WindowBridge {
  return {
    control: (action) => ipcRenderer.invoke("pigclaude:window", action),
    getCloseToTray: async () =>
      (await ipcRenderer.invoke("pigclaude:window-close-to-tray-get")) === true,
    setCloseToTray: async (value) =>
      (await ipcRenderer.invoke("pigclaude:window-close-to-tray-set", value)) === true,
    onNavigation: windowNavigationListener(),
    isMaximized: async () => (await ipcRenderer.invoke("pigclaude:is-maximized")) === true,
    isFullScreen: async () => (await ipcRenderer.invoke("pigclaude:is-full-screen")) === true,
    onFullScreenChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) =>
        listener(value === true)
      ipcRenderer.on("pigclaude:full-screen", handler)
      return () => ipcRenderer.removeListener("pigclaude:full-screen", handler)
    },
    setTitleBarColors: (colors) => ipcRenderer.invoke("pigclaude:title-bar", colors),
    setTranslucent: (translucent) => ipcRenderer.invoke("pigclaude:set-translucent", translucent),
    popupMenu: async (items, position) => {
      const value: unknown = await ipcRenderer.invoke("pigclaude:menu", items, position)
      return typeof value === "string" ? value : null
    },
  }
}
