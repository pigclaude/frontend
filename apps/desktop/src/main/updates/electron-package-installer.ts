// 负责 Windows 和 Linux AppImage 的安装：electron-updater 读取安装包内置的发布源，后台下载，退出时安装。
import type { PackageInstaller } from "./update-service"

/**
 * 用 electron-updater 实现安装器。不降级、不收预发布、下载完不自动安装；
 * 正常退出时由 electron-updater 安装，选「重启并更新」时安装完再打开应用。
 */
export function electronPackageInstaller(): PackageInstaller {
  return {
    async download(onProgress) {
      const { autoUpdater } = await import("electron-updater")
      // 没有监听者时 error 事件会变成未捕获异常。
      if (autoUpdater.listenerCount("error") === 0) autoUpdater.on("error", () => undefined)
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.autoRunAppAfterInstall = false
      autoUpdater.allowDowngrade = false
      autoUpdater.allowPrerelease = false
      const progress = (value: { percent: number }) => onProgress(value.percent)
      autoUpdater.on("download-progress", progress)
      try {
        const result = await autoUpdater.checkForUpdates()
        if (!result?.isUpdateAvailable) throw new Error("update source has no newer version")
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.removeListener("download-progress", progress)
      }
    },
    async launchInstaller() {
      const { autoUpdater } = await import("electron-updater")
      if (!canInstall(autoUpdater) || !autoUpdater.install(true, true)) {
        throw new Error("update installer did not start")
      }
    },
  }
}

type InstallingUpdater = { install(isSilent: boolean, isForceRunAfter: boolean): boolean }

function canInstall(updater: object): updater is InstallingUpdater {
  return typeof Reflect.get(updater, "install") === "function"
}
