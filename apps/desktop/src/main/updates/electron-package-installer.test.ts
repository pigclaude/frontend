// 验证 Windows 和 Linux 的安装器：不降级、不收预发布、下载完不自动安装；安装器没能启动时报错。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { electronPackageInstaller } from "./electron-package-installer"

const updater = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events")
  return Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: true,
    allowDowngrade: true,
    allowPrerelease: true,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    install: vi.fn(),
  })
})

vi.mock("electron-updater", () => ({ autoUpdater: updater }))

describe("electron-updater 安装器", () => {
  beforeEach(() => {
    updater.removeAllListeners()
    updater.checkForUpdates.mockReset()
    updater.downloadUpdate.mockReset()
    updater.install.mockReset()
  })

  it("只下载更高的正式版本，退出时安装但不自动重启，并报告进度", async () => {
    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true })
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit("download-progress", { percent: 42 })
    })
    const progress = vi.fn()
    await electronPackageInstaller().download(progress)
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: true,
      autoRunAppAfterInstall: false,
      allowDowngrade: false,
      allowPrerelease: false,
    })
    expect(progress).toHaveBeenCalledWith(42)
    expect(updater.listenerCount("download-progress")).toBe(0)
    expect(updater.listenerCount("error")).toBe(1)
  })

  it("源上没有更高的版本时不下载并报错", async () => {
    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false })
    await expect(electronPackageInstaller().download(() => undefined)).rejects.toThrow()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it("静默安装后重新打开应用；安装器没能启动时报错", async () => {
    updater.install.mockReturnValueOnce(true).mockReturnValueOnce(false)
    const installer = electronPackageInstaller()
    await expect(installer.launchInstaller()).resolves.toBeUndefined()
    expect(updater.install).toHaveBeenCalledWith(true, true)
    await expect(installer.launchInstaller()).rejects.toThrow()
  })
})
