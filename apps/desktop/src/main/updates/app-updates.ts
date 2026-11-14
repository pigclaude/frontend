// 负责把更新服务接到 Electron：公开发布仓库、系统网络、下载目录、系统外壳和统一的退出流程。
import { app, net, shell } from "electron"
import { join } from "node:path"
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import { electronPackageInstaller } from "./electron-package-installer"
import { clearDownloads, downloadVerifiedPackage } from "./mac-update-package"
import { fetchLatestRelease, LATEST_RELEASE_API, LATEST_RELEASE_PAGE } from "./update-release"
import { updateMode } from "./update-mode"
import { createUpdateService, type UpdateService } from "./update-service"
import { readAutoCheck, writeAutoCheck } from "./update-settings"

/** 接线需要的两件事：走统一退出确认的退出，以及把状态推给窗口。 */
export type AppUpdatesOptions = {
  requestQuit: () => void
  onState: (state: DesktopUpdateState) => void
}

/**
 * 创建应用的更新服务。`PIGCLAUDE_UPDATE_CHECK=0` 时不发任何更新请求；
 * `PIGCLAUDE_UPDATE_API` 只在开发运行时生效，用来指向本地假更新源。检查不带登录凭据。
 */
export function createAppUpdates(options: AppUpdatesOptions): UpdateService {
  const env = process.env
  const userData = app.getPath("userData")
  const settingsFile = join(userData, "update-settings.json")
  const downloads = join(userData, "update-downloads")
  const apiUrl = (!app.isPackaged && env["PIGCLAUDE_UPDATE_API"]) || LATEST_RELEASE_API
  const fetchImpl: typeof fetch = (input, init) => net.fetch(String(input), init)
  void clearDownloads(downloads).catch(() => undefined)
  return createUpdateService({
    currentVersion: app.getVersion(),
    mode: updateMode(process.platform, env, app.isPackaged),
    arch: process.arch,
    enabled: env["PIGCLAUDE_UPDATE_CHECK"] !== "0",
    downloadPage: LATEST_RELEASE_PAGE,
    autoCheck: () => readAutoCheck(settingsFile),
    saveAutoCheck: (value) => writeAutoCheck(settingsFile, value),
    findRelease: () => fetchLatestRelease(apiUrl, fetchImpl),
    fetchText: async (url) => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`update manifest failed: HTTP ${response.status}`)
      return response.text()
    },
    downloadMacPackage: (pkg, onProgress) =>
      downloadVerifiedPackage(pkg, downloads, fetchImpl, onProgress),
    installer: electronPackageInstaller(),
    openPath: async (path) => {
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    },
    openExternal: (url) => shell.openExternal(url),
    requestQuit: options.requestQuit,
    onState: options.onState,
  })
}
