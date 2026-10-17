// 负责创建桌面窗口，并在开发时加载 electron-vite 的渲染地址。
import { app, BrowserWindow, ipcMain, shell } from "electron"
import { join } from "node:path"
import { createMainWindowOptions, developmentRendererUrl } from "./window-options"

ipcMain.handle("pigclaude:open-external", async (_event, url: unknown) => {
  if (typeof url !== "string") return
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  const allowed = parsed.protocol === "https:" || parsed.protocol === "http:"
  if (!allowed || !parsed.pathname.startsWith("/authorize")) return
  await shell.openExternal(parsed.toString())
})

/** 打开主窗口。开发环境走渲染进程地址，打包后加载本地页面。 */
function createWindow(): void {
  const mainWindow = new BrowserWindow(
    createMainWindowOptions({
      platform: process.platform,
      preloadPath: join(__dirname, "../preload/index.js"),
      isPackaged: app.isPackaged,
    }),
  )
  const devRendererUrl = developmentRendererUrl(
    app.isPackaged,
    process.env["ELECTRON_RENDERER_URL"],
  )
  if (devRendererUrl) {
    void mainWindow.loadURL(devRendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow.show()
  })
}

void app.whenReady().then(() => {
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
