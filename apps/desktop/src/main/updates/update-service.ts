// 负责应用更新的状态：检查、后台下载、校验、安装和失败都在这里决定，顶栏和设置页读同一份状态。
import type { DesktopUpdateState } from "@pigclaude/ui-contracts"
import { MAC_MANIFEST, pickMacPackage, type MacPackage } from "./mac-update-package"
import { isNewer, type LatestRelease } from "./update-release"
import { createUpdateScheduler, type SchedulerTimers } from "./update-scheduler"

/**
 * 发现新版本后怎么处理：install 由 electron-updater 后台下载、退出时安装（Windows、AppImage）；
 * replace 下载 DMG 校验后让用户手动替换（macOS）；notify 只打开发布页（开发运行和其他 Linux 包）。
 */
export type UpdateMode = "install" | "replace" | "notify"

/** 手动检查的结果，设置页直接显示。 */
export type UpdateResult = {
  status: "up-to-date" | "update-available" | "error"
  version?: string
  url?: string
}

/** Windows、Linux 的安装器：下载到 electron-updater 的缓存，退出时安装。 */
export type PackageInstaller = {
  download(onProgress: (percent: number) => void): Promise<void>
  /** 在退出清理完成后启动安装器，安装完再打开应用。安装器没能启动时不保证退出，调用方兜底。 */
  quitAndInstall(): Promise<void>
}

/** 更新服务的依赖；网络、文件、系统外壳和退出都从这里注入，测试用本地假更新源驱动。 */
export type UpdateServiceOptions = {
  currentVersion: string
  mode: UpdateMode
  arch: string
  /** 环境变量关闭检查时为 false：不发出任何更新请求。 */
  enabled: boolean
  autoCheck: () => boolean
  saveAutoCheck: (value: boolean) => Promise<void>
  findRelease: () => Promise<LatestRelease | null>
  fetchText: (url: string) => Promise<string>
  downloadMacPackage: (pkg: MacPackage, onProgress: (percent: number) => void) => Promise<string>
  installer: PackageInstaller
  openPath: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  /** 走统一的退出确认退出应用。 */
  requestQuit: () => void
  onState: (state: DesktopUpdateState) => void
  timers?: SchedulerTimers
}

/** 主进程持有的更新服务。 */
export type UpdateService = {
  /** 按设置开始自动检查。 */
  start(): void
  stop(): void
  getState(): DesktopUpdateState
  checkNow(): Promise<UpdateResult>
  /** 执行当前状态给出的动作：下载（或重试）、重启并更新、打开安装包、打开发布页。 */
  perform(): Promise<DesktopUpdateState>
  setAutoCheck(value: boolean): Promise<DesktopUpdateState>
  /** 用系统浏览器打开主进程持有的发布页；没有发布页时什么都不做。 */
  openReleaseNotes(): Promise<void>
  /** 用户选了「重启并更新」且退出确认通过时返回 true，退出流程的最后一步改为启动安装器。 */
  restartRequested(): boolean
  /** 退出确认被取消，「重启并更新」也随之取消。 */
  cancelRestart(): void
  /** 退出清理的最后一步：启动安装器，安装完再打开应用；启动失败时记为安装失败，不抛出。 */
  installAndRestart(): Promise<void>
}

/** 创建更新服务。只接受比当前版本高的正式版本；下载好只提示，不自动重启。 */
export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  let release: LatestRelease | null = null
  let packagePath: string | null = null
  let restart = false
  let operation: Promise<void> | null = null
  let state: DesktopUpdateState = {
    autoCheck: options.autoCheck(),
    phase: "idle",
    currentVersion: options.currentVersion,
    version: null,
    url: null,
    action: null,
    progress: null,
    error: null,
  }
  const publish = (patch: Partial<DesktopUpdateState>) => {
    state = { ...state, ...patch }
    options.onState(state)
  }
  const settled = () => state.phase === "downloading" || state.phase === "ready"

  const scheduler = createUpdateScheduler({
    autoCheck: () => options.enabled && options.autoCheck(),
    check,
    ...(options.timers ? { timers: options.timers } : {}),
  })

  async function check(): Promise<UpdateResult> {
    if (settled()) return result()
    publish({ phase: "checking", error: null })
    let found: LatestRelease | null
    try {
      found = await options.findRelease()
    } catch {
      publish({ phase: release ? "available" : "failed", error: "check" })
      return { status: "error" }
    }
    if (settled()) return result()
    if (!found || !isNewer(found.version, options.currentVersion)) {
      release = null
      publish({ phase: "idle", version: null, url: null, action: null, progress: null })
      return { status: "up-to-date" }
    }
    release = found
    publish({
      phase: "available",
      version: found.version,
      url: found.url,
      action: options.mode === "notify" ? "open-release" : "download",
      progress: null,
    })
    if (options.mode !== "notify") void run(download)
    return result()
  }

  function result(): UpdateResult {
    return release
      ? { status: "update-available", version: release.version, url: release.url }
      : { status: "up-to-date" }
  }

  async function download(): Promise<void> {
    const selected = release
    if (!selected) return
    publish({ phase: "downloading", progress: 0, error: null })
    const onProgress = (percent: number) =>
      publish({ progress: Math.max(0, Math.min(100, Math.floor(percent))) })
    try {
      if (options.mode === "install") {
        await options.installer.download(onProgress)
        publish({ phase: "ready", action: "restart", progress: 100 })
        return
      }
      const pkg = await macPackage(selected)
      if (!pkg) {
        publish({ phase: "available", action: "open-release", progress: null })
        return
      }
      packagePath = await options.downloadMacPackage(pkg, onProgress)
      publish({ phase: "ready", action: "open-package", progress: 100 })
    } catch {
      publish({ phase: "failed", action: "download", progress: null, error: "download" })
    }
  }

  async function macPackage(selected: LatestRelease): Promise<MacPackage | null> {
    const manifest = selected.assets.find((asset) => asset.name === MAC_MANIFEST)
    if (!manifest) return null
    return pickMacPackage(await options.fetchText(manifest.url), selected, options.arch)
  }

  async function openPackage(): Promise<void> {
    if (!packagePath) return
    try {
      await options.openPath(packagePath)
    } catch {
      publish({ phase: "failed", error: "open" })
      return
    }
    publish({ phase: "ready", error: null })
    options.requestQuit()
  }

  async function openRelease(): Promise<void> {
    if (!release) return
    try {
      await options.openExternal(release.url)
      publish({ error: null })
    } catch {
      publish({ phase: "failed", error: "open" })
    }
  }

  function run(task: () => Promise<void>): Promise<void> {
    operation ??= task().finally(() => {
      operation = null
    })
    return operation
  }

  return {
    start() {
      publish({ autoCheck: options.autoCheck() })
      scheduler.start()
    },
    stop: () => scheduler.stop(),
    getState: () => state,
    checkNow() {
      if (!options.enabled) return Promise.resolve({ status: "error" })
      return scheduler.checkNow()
    },
    async perform() {
      if (operation) return state
      if (state.action === "download") await run(download)
      else if (state.action === "open-package") await run(openPackage)
      else if (state.action === "open-release") await run(openRelease)
      else if (state.action === "restart" && state.phase === "ready") {
        restart = true
        options.requestQuit()
      }
      return state
    },
    async setAutoCheck(value) {
      await options.saveAutoCheck(value)
      publish({ autoCheck: value })
      scheduler.start()
      return state
    },
    async openReleaseNotes() {
      if (state.url) await options.openExternal(state.url)
    },
    restartRequested: () => restart && state.action === "restart",
    cancelRestart() {
      restart = false
    },
    async installAndRestart() {
      restart = false
      try {
        await options.installer.quitAndInstall()
      } catch {
        publish({ phase: "failed", error: "install" })
      }
    },
  }
}
