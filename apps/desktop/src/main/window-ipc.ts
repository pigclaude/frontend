// 负责外壳需要的窗口 IPC：窗口按钮、最大化与全屏状态、标题栏菜单、原生标题栏配色和侧栏透明。
// 只接受校验过的值和受信任的主窗口，窗口一律取发消息的那个。
import type {
  BrowserWindow as BrowserWindowType,
  IpcMain,
  IpcMainInvokeEvent,
  NativeTheme,
} from "electron"
import { supportsTranslucency } from "@pigclaude/ui-primitives/theme-tokens"
import { popupNativeMenu, readMenuPosition, readNativeMenu, type MenuFactory } from "./native-menu"
import {
  TITLE_BAR_HEIGHT,
  readTitleBarColors,
  usesTitleBarOverlay,
  windowBackground,
  windowMaterial,
} from "./window-options"

/** 注册窗口 IPC 需要的 Electron 能力；测试里可以替换。 */
export type WindowIpcDeps = {
  ipcMain: Pick<IpcMain, "handle">
  windows: { fromWebContents: typeof BrowserWindowType.fromWebContents }
  nativeTheme: Pick<NativeTheme, "shouldUseDarkColors">
  menus: MenuFactory
  platform: NodeJS.Platform
  systemVersion: string
  allowDevRoles: boolean
  isTrusted: (event: IpcMainInvokeEvent) => boolean
}

/** 注册窗口相关 IPC；每个处理函数只作用于发消息的受信任窗口。 */
export function registerWindowIpc(deps: WindowIpcDeps): void {
  const target = (event: IpcMainInvokeEvent): BrowserWindowType | null =>
    deps.isTrusted(event) ? deps.windows.fromWebContents(event.sender) : null

  deps.ipcMain.handle("pigclaude:window", (event, action: unknown) => {
    const window = target(event)
    if (!window) return
    if (action === "minimize") window.minimize()
    else if (action === "maximize") {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    } else if (action === "close") window.close()
  })
  deps.ipcMain.handle("pigclaude:is-maximized", (event) => target(event)?.isMaximized() ?? false)
  deps.ipcMain.handle("pigclaude:is-full-screen", (event) => target(event)?.isFullScreen() ?? false)
  // 标题栏菜单由页面描述、主进程弹出原生菜单；返回被点击的命令 id。
  deps.ipcMain.handle("pigclaude:menu", (event, items: unknown, position: unknown) => {
    const window = target(event)
    const menu = readNativeMenu(items, { allowDevRoles: deps.allowDevRoles })
    const at = readMenuPosition(position)
    if (!window || !menu || !at) return null
    const zoom = event.sender.getZoomFactor()
    return popupNativeMenu(deps.menus, window, menu, { x: at.x * zoom, y: at.y * zoom })
  })
  // 原生窗口按钮的底色与图标色跟随页面当前外观；macOS 的交通灯不需要。
  deps.ipcMain.handle("pigclaude:title-bar", (event, value: unknown) => {
    const colors = readTitleBarColors(value)
    const window = target(event)
    if (!colors || !window || !usesTitleBarOverlay(deps.platform)) return
    window.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT })
  })
  // 侧栏透明：窗口底色设成透明并换成更透的系统材质；没有可用材质的系统不动窗口，透明底色在那里只会变黑。
  deps.ipcMain.handle("pigclaude:set-translucent", (event, value: unknown) => {
    const window = target(event)
    if (!window || typeof value !== "boolean") return
    if (!supportsTranslucency(deps.platform, deps.systemVersion)) return
    window.setBackgroundColor(windowBackground(value, deps.nativeTheme.shouldUseDarkColors))
    const material = windowMaterial(deps.platform, value)
    if (material && "vibrancy" in material) window.setVibrancy(material.vibrancy)
    if (material && "backgroundMaterial" in material) {
      window.setBackgroundMaterial(material.backgroundMaterial)
    }
  })
}

/** 把窗口进入、退出全屏告诉页面；macOS 全屏时交通灯隐藏，外壳据此收回留白。 */
export function forwardFullScreen(
  window: Pick<BrowserWindowType, "on"> & { webContents: Pick<Electron.WebContents, "send"> },
): void {
  if (typeof window.on !== "function") return
  window.on("enter-full-screen", () => window.webContents.send("pigclaude:full-screen", true))
  window.on("leave-full-screen", () => window.webContents.send("pigclaude:full-screen", false))
}
