// 组装桌面窗口的偏好、外观、原生菜单、目录选择与系统导航桥。

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme } from "electron"
import { readDockIconDataUrl } from "./dock-icon"
import { errorMessage } from "./error-message"
import { registerFolderPickerIpc } from "./folder-picker"
import { applyGlassBackground } from "./glass-background"
import { electronMenuFactory } from "./native-menu"
import { readClaudeCodeVersion } from "./session/claude-version"
import {
  registerWindowClosePreference,
  type WindowClosePreference,
} from "./window-close-preference"
import { registerWindowIpc } from "./window-ipc"
import type { WindowNavigation } from "./window-navigation"
import { readThemeSource } from "./window-options"

/** 使用现有受信判断注册窗口相关 IPC；目录选择与外观使用当前主窗口。 */
export function registerDesktopWindowIpc(
  window: () => BrowserWindow | null,
  isTrusted: (event: Electron.IpcMainInvokeEvent) => boolean,
  closePreference: WindowClosePreference,
  navigation: WindowNavigation,
): void {
  registerWindowClosePreference(ipcMain, isTrusted, closePreference)
  navigation.register(ipcMain, isTrusted)
  let claudeCodeVersion = readClaudeCodeVersion()
  ipcMain.handle("pigclaude:app-info", async () => {
    const version = await claudeCodeVersion
    if (version === null) claudeCodeVersion = readClaudeCodeVersion()
    return {
      appVersion: app.getVersion(),
      userDataPath: app.getPath("userData"),
      claudeCodeVersion: version,
    }
  })
  registerFolderPickerIpc(ipcMain, (options) => {
    const target = window()
    return target ? dialog.showOpenDialog(target, options) : dialog.showOpenDialog(options)
  })
  registerWindowIpc({
    ipcMain,
    windows: BrowserWindow,
    nativeTheme,
    menus: electronMenuFactory(),
    platform: process.platform,
    systemVersion: process.getSystemVersion?.() ?? "unknown",
    allowDevRoles: !app.isPackaged,
    isTrusted,
  })
  ipcMain.handle("pigclaude:set-theme", (_event, value: unknown) => {
    const source = readThemeSource(value)
    if (source) nativeTheme.themeSource = source
  })
  nativeTheme.on("updated", () =>
    applyGlassBackground(window(), process.platform, nativeTheme.shouldUseDarkColors),
  )
  ipcMain.handle("pigclaude:set-dock-icon", (_event, value: unknown) => {
    if (process.platform !== "darwin") return
    const dataUrl = readDockIconDataUrl(value)
    if (!dataUrl) return
    try {
      const image = nativeImage.createFromDataURL(dataUrl)
      if (!image.isEmpty()) app.dock?.setIcon(image)
    } catch (error: unknown) {
      console.error(errorMessage(error))
    }
  })
}
