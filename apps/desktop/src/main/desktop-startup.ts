// 负责接入当前 Electron 应用的登录项与 macOS Dock 能力。

import { app } from "electron"
import { join } from "node:path"
import { createLoginStartup } from "./login-startup"
import { StartupPreferences } from "./startup-preferences"

/** 为本次启动选择系统适配。创建时不写入系统登录项。 */
export function createDesktopStartup(): StartupPreferences {
  const login = createLoginStartup({
    platform: process.platform,
    packaged: app.isPackaged,
    executable: process.execPath,
    home: app.getPath("home"),
    env: process.env,
    native: app,
  })
  const dock = process.platform === "darwin" ? app.dock : undefined
  return new StartupPreferences(
    login,
    dock
      ? {
          filePath: join(app.getPath("userData"), "startup-preferences.json"),
          async apply(visible) {
            if (visible) await dock.show()
            else dock.hide()
          },
        }
      : null,
  )
}

/** 记录初始化期间的 Dock 唤回请求，主窗口创建后按正常方式唤回。 */
export function registerDesktopActivation(
  startup: StartupPreferences,
  visibility: { restoreExisting: () => unknown; restore: () => void },
): () => void {
  let activate = () => startup.requestForeground(visibility.restoreExisting)
  app.on("activate", () => activate())
  return () => {
    activate = visibility.restore
  }
}
