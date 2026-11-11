// 负责直接启动 PigBrowser 内核：每个账号一个 user-data-dir，CLI 传指纹，代理参数可选。

import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { isAbsolute, join, relative } from "node:path"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import type { EnvironmentCheckRequest } from "./environment-check-model"
import { approvedEnvironmentBrowser } from "./environment-runtime"
import { BrowserLaunchError, BrowserStartupCleanupError } from "./browser-launch-errors"
/** 保留启动器公共错误入口，定义与回收语义集中在错误模块。 */
export {
  BrowserLaunchError,
  BrowserStartupCleanupError,
  type BrowserErrorCode,
} from "./browser-launch-errors"
import { BrowserProcessExitedError } from "./browser-control-pipe"
import {
  observeExit,
  waitForSpawn,
  waitForExit,
  waitUntilExit,
  type ManagedProcess,
} from "./browser-process"
import {
  BrowserStartupTimeoutError,
  openAuthorizedPage,
  type BrowserStartupInput,
} from "./browser-startup"
import { buildFingerprintArgs, ensureFingerprint, type ScreenSize } from "./fingerprint-args"
import {
  launchArgumentConflict,
  localBridgePort,
  managedCallbackPort,
} from "./launch-argument-guard"
import { matchesRuntimeBinary, runtimeHostArch } from "./runtime-binary"

const defaultStopTimeoutMs = 3_000
// 固定 PigBrowser 156 的 CHROME_RESULT_CODE_UNSUPPORTED_PARAM。
const unsupportedParameterExitCode = 13

/** 启动器配置。binaryPath 优先，其次读取 PIGCLAUDE_PIGBROWSER_BIN。 */
export type FingerprintChromiumConfig = {
  binaryPath?: string | undefined
  profilesRoot: string
  env?: Record<string, string | undefined>
  spawn?: typeof spawn
  /** 页面启动操作；缺省通过本次浏览器进程的管道执行。 */
  openPage?: (input: BrowserStartupInput) => Promise<void>
  /** 完整资源校验端口；测试可注入合成文件系统的验证结果。 */
  verifyEnvironmentBrowser?: typeof approvedEnvironmentBrowser
  stopTimeoutMs?: number
  /** 宿主屏幕可用区域，用于计算默认窗口大小；缺省按 1920x1080。 */
  screenSize?: ScreenSize | undefined
  /** 参数解析所用的真实宿主平台；缺省取当前进程平台。 */
  hostPlatform?: NodeJS.Platform
  /** 按宿主架构选择原生内核；缺省自动识别。 */
  hostArch?: string
  /** 安装包资源根目录；提供时不回退到系统内核。 */
  resourcesPath?: string
}

/** 浏览器网络模式；绑定代理时必须提供本机代理桥和本次授权回调。 */
export type LaunchBrowserNetwork =
  { mode: "system" } | { mode: "bound"; bridgeUrl: string; callbackUri: string }

/** 启动一次登录需要的输入，必须显式区分系统网络和已绑定代理。 */
export type LaunchBrowserInput = {
  browserProfileId?: string
  browserDataId?: string
  accountId: string
  authorizeUrl: string
  network: LaunchBrowserNetwork
  fingerprint: ClaudeFingerprintView
  /** 由账号服务绑定本次自检；缺证据不能换取令牌。 */
  environmentCheck?: EnvironmentCheckRequest
  /** 若提供，在创建进程前确认本次授权仍未取消。 */
  signal?: AbortSignal
  /** 在同步创建进程前重新核对授权服务的启动条件。 */
  assertCanSpawn?: () => void
  /** 打开授权页面前再次确认回调仍在等待。 */
  assertCanNavigate?: () => void
}

/** 一次成功启动的结果。 */
export type LaunchedBrowser = {
  profileDir: string
  pid: number | null
  /** 浏览器进程结束时完成，供授权流程结束等待。 */
  exited: Promise<void>
  /** 只停止这次启动的进程，不影响同账号后续启动的实例。 */
  stop: () => Promise<void>
}

/** 直接调用 PigBrowser 的启动器。保证进程和配置目录都绑定到单个账号。 */
export class FingerprintChromiumAdapter {
  readonly #binaryPath: string | undefined
  readonly #profilesRoot: string
  readonly #env: Record<string, string | undefined>
  readonly #spawn: typeof spawn
  readonly #openPage: (input: BrowserStartupInput) => Promise<void>
  readonly #verifyEnvironmentBrowser: typeof approvedEnvironmentBrowser
  readonly #stopTimeoutMs: number
  readonly #screenSize: ScreenSize | undefined
  readonly #hostPlatform: NodeJS.Platform
  readonly #hostArch: string
  readonly #resourcesPath: string | undefined
  readonly #processes = new Map<string, ManagedProcess>()
  readonly #operations = new Map<string, Promise<void>>()
  readonly #stops = new Map<
    string,
    Set<{ expected?: ManagedProcess | undefined; promise: Promise<void> }>
  >()
  readonly #shutdown = new AbortController()
  #closed = false

  /** 创建绑定到账号配置根目录的启动器。 */
  constructor(config: FingerprintChromiumConfig) {
    this.#binaryPath = config.binaryPath
    this.#profilesRoot = config.profilesRoot
    this.#env = config.env ?? process.env
    this.#spawn = config.spawn ?? spawn
    this.#openPage = config.openPage ?? openAuthorizedPage
    this.#verifyEnvironmentBrowser = config.verifyEnvironmentBrowser ?? approvedEnvironmentBrowser
    this.#stopTimeoutMs = config.stopTimeoutMs ?? defaultStopTimeoutMs
    this.#screenSize = config.screenSize
    this.#hostPlatform = config.hostPlatform ?? process.platform
    this.#hostArch = config.hostArch ?? runtimeHostArch()
    this.#resourcesPath = config.resourcesPath
  }

  /** 返回账号的浏览器配置目录。保证目录名只来自账号 ID，不能越出 profilesRoot。 */
  profileDir(accountId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(accountId)) {
      throw new BrowserLaunchError("BROWSER_START_FAILED", "账号 ID 不合法")
    }
    const dir = join(this.#profilesRoot, accountId)
    const rel = relative(this.#profilesRoot, dir)
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new BrowserLaunchError("BROWSER_START_FAILED", "浏览器配置目录不合法")
    }
    return dir
  }

  /** 解析并验证内核可执行文件。找不到时明确失败，不回退到系统 Chromium。 */
  async ensureAvailable(): Promise<string> {
    const configured = this.#binaryPath ?? this.#env["PIGCLAUDE_PIGBROWSER_BIN"]
    const candidates =
      configured !== undefined && configured !== ""
        ? [configured]
        : this.#resourcesPath !== undefined
          ? [packagedBrowserPath(this.#resourcesPath, this.#hostPlatform, this.#hostArch)]
          : []
    for (const candidate of candidates) {
      if (await matchesRuntimeBinary(candidate, this.#hostPlatform, this.#hostArch))
        return candidate
    }
    throw new BrowserLaunchError(
      "BROWSER_MISSING",
      "找不到 PigBrowser 内核；请准备运行资源或设置 PIGCLAUDE_PIGBROWSER_BIN",
    )
  }

  /** 启动内核并打开授权 URL。保证同一账号旧进程退出后才启动，种子由账号 ID 稳定生成。 */
  async launch(input: LaunchBrowserInput): Promise<LaunchedBrowser> {
    if (this.#closed) throw new BrowserLaunchError("BROWSER_START_FAILED", "浏览器启动器已关闭")
    const { accountId, authorizeUrl, signal, assertCanSpawn, assertCanNavigate } = input
    const validation = ensureFingerprint(input.fingerprint, accountId)
    if (!validation.ok) {
      throw new BrowserLaunchError("BROWSER_START_FAILED", validation.message)
    }
    const network = validatedNetwork(input.network)
    if (input.environmentCheck && this.#env["NODE_TLS_REJECT_UNAUTHORIZED"] === "0") {
      throw new BrowserLaunchError("BROWSER_START_FAILED", "授权环境自检要求保留 TLS 证书校验")
    }
    const conflict = launchArgumentConflict(
      validation.fingerprint.unknownArgs ?? [],
      network.mode === "bound",
      this.#hostPlatform,
      validation.fingerprint.webrtcPolicy,
    )
    if (conflict !== null) throw new BrowserLaunchError("BROWSER_START_FAILED", conflict)
    return this.#serialize(accountId, async () => {
      signal?.throwIfAborted()
      if (this.#closed) throw new BrowserLaunchError("BROWSER_START_FAILED", "浏览器启动器已关闭")
      const binary = await this.ensureAvailable()
      if (
        input.environmentCheck &&
        !(await this.#verifyEnvironmentBrowser(binary, this.#hostPlatform, this.#hostArch))
      ) {
        throw new BrowserLaunchError(
          "BROWSER_START_FAILED",
          "未能验证固定 PigBrowser 完整资源，请重新准备已批准开发包",
        )
      }
      signal?.throwIfAborted()
      if (this.#closed) throw new BrowserLaunchError("BROWSER_START_FAILED", "浏览器启动器已关闭")
      await this.#stopUnlocked(accountId)
      const profileDir = this.profileDir(accountId)
      await mkdir(profileDir, { recursive: true, mode: 0o700 })
      signal?.throwIfAborted()
      if (this.#closed) throw new BrowserLaunchError("BROWSER_START_FAILED", "浏览器启动器已关闭")
      const args = buildLaunchArgs(network, validation.fingerprint, profileDir, this.#screenSize)
      let child: ChildProcess
      let managed: ManagedProcess
      assertCanSpawn?.()
      try {
        child = this.#spawn(binary, args, {
          detached: true,
          stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
        })
        managed = observeExit(child, (finished) => {
          if (this.#processes.get(accountId) === finished) this.#processes.delete(accountId)
        })
        await waitForSpawn(child)
      } catch {
        throw new BrowserLaunchError("BROWSER_START_FAILED", "启动指纹浏览器失败")
      }
      if (!managed.exited) this.#processes.set(accountId, managed)
      const launched: LaunchedBrowser = {
        profileDir,
        pid: child.pid ?? null,
        exited: waitForExit(managed),
        stop: () => this.#requestStop(accountId, managed),
      }
      const startupSignal =
        signal === undefined
          ? this.#shutdown.signal
          : AbortSignal.any([signal, this.#shutdown.signal])
      let navigationError: unknown
      let navigationBlocked = false
      try {
        await this.#openPage({
          child,
          registerGracefulClose: (close) => {
            managed.requestClose = close
          },
          authorizeUrl,
          signal: startupSignal,
          extensionArgs: validation.fingerprint.unknownArgs,
          hostPlatform: this.#hostPlatform,
          environmentCheck: input.environmentCheck
            ? {
                request: input.environmentCheck,
                browserProfile: input.environmentCheck.browserProfile,
                expectedExitIp: input.environmentCheck.expectedExitIp,
                accountId,
                fingerprint: validation.fingerprint,
                network,
                launchArgs: args,
              }
            : undefined,
          assertCanNavigate: () => {
            try {
              signal?.throwIfAborted()
              if (this.#closed) {
                throw new BrowserLaunchError("BROWSER_START_FAILED", "浏览器启动器已关闭")
              }
              assertCanSpawn?.()
              assertCanNavigate?.()
            } catch (error: unknown) {
              navigationBlocked = true
              navigationError = error
              throw error
            }
          },
        })
        startupSignal.throwIfAborted()
      } catch (error: unknown) {
        try {
          await this.#stopUnlocked(accountId, managed)
        } catch {
          throw new BrowserStartupCleanupError(launched)
        }
        signal?.throwIfAborted()
        if (navigationBlocked) throw navigationError
        if (this.#closed) throw new BrowserLaunchError("BROWSER_START_FAILED", "浏览器启动器已关闭")
        if (error instanceof BrowserProcessExitedError) {
          if (child.exitCode === unsupportedParameterExitCode) {
            throw new BrowserLaunchError(
              "BROWSER_START_FAILED",
              "PigBrowser 不支持当前指纹参数，请检查语言、地区、时区及版本设置",
            )
          }
          throw error
        }
        if (error instanceof BrowserStartupTimeoutError) {
          throw new BrowserLaunchError("BROWSER_START_FAILED", error.message)
        }
        throw new BrowserLaunchError("BROWSER_START_FAILED", "无法确认扩展状态或打开授权页面")
      }
      child.unref()
      return launched
    })
  }

  /** 停止账号的浏览器进程。未确认退出时保留跟踪并报告失败。 */
  async stop(accountId: string): Promise<void> {
    await this.#requestStop(accountId)
  }

  #requestStop(accountId: string, expected?: ManagedProcess): Promise<void> {
    const entries = this.#stops.get(accountId) ?? new Set()
    const current = this.#processes.get(accountId)
    if (this.#closed && (expected === undefined || expected === current)) {
      const pending = [...entries].find(
        (entry) => entry.expected === undefined || entry.expected === current,
      )
      if (pending !== undefined) return pending.promise
    }
    const promise = this.#serialize(accountId, () => this.#stopUnlocked(accountId, expected))
    const entry = { expected, promise }
    entries.add(entry)
    this.#stops.set(accountId, entries)
    const removeEntry = () => {
      entries.delete(entry)
      if (entries.size === 0 && this.#stops.get(accountId) === entries)
        this.#stops.delete(accountId)
    }
    void promise.then(removeEntry, removeEntry)
    return promise
  }

  async #stopUnlocked(accountId: string, expected?: ManagedProcess): Promise<void> {
    const managed = this.#processes.get(accountId)
    if (managed === undefined || (expected !== undefined && managed !== expected)) return
    try {
      if (managed.exited) return
      if (managed.requestClose?.() && (await waitUntilExit(managed, this.#stopTimeoutMs))) return
      managed.child.kill("SIGTERM")
      if (await waitUntilExit(managed, this.#stopTimeoutMs)) return
      managed.child.kill("SIGKILL")
      if (!(await waitUntilExit(managed, 1_000))) {
        throw new BrowserLaunchError(
          "BROWSER_STOP_FAILED",
          "无法确认浏览器已退出，请手动关闭后重试",
        )
      }
    } catch {
      throw new BrowserLaunchError("BROWSER_STOP_FAILED", "无法确认浏览器已退出，请手动关闭后重试")
    }
  }

  /** 删除账号的浏览器配置目录。保证先停止进程，且只删除 profilesRoot 下的目录。 */
  async deleteProfile(accountId: string): Promise<void> {
    await this.#serialize(accountId, async () => {
      await this.#stopUnlocked(accountId)
      const dir = this.profileDir(accountId)
      try {
        await rm(dir, { recursive: true, force: true })
      } catch {
        throw new BrowserLaunchError("BROWSER_PROFILE_DELETE_FAILED", "删除浏览器配置目录失败")
      }
    })
  }

  /** 停止全部由本进程启动的浏览器。 */
  async stopAll(): Promise<void> {
    const accounts = new Set([...this.#processes.keys(), ...this.#operations.keys()])
    const results = await Promise.allSettled([...accounts].map((accountId) => this.stop(accountId)))
    if (results.some((result) => result.status === "rejected")) {
      throw new BrowserLaunchError("BROWSER_STOP_FAILED", "无法确认浏览器已退出，请手动关闭后重试")
    }
  }

  /** 关闭启动入口并等待所有已开始的浏览器操作完成。 */
  async dispose(): Promise<void> {
    this.#closed = true
    this.#shutdown.abort()
    const pending = [...this.#operations.values()]
    const [stops] = await Promise.allSettled([this.stopAll(), ...pending])
    if (stops?.status === "rejected") throw stops.reason
  }

  #serialize<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#operations.get(accountId) ?? Promise.resolve()
    const current = previous.then(operation)
    const settled = current.then(
      () => undefined,
      () => undefined,
    )
    this.#operations.set(accountId, settled)
    void settled.then(() => {
      if (this.#operations.get(accountId) === settled) this.#operations.delete(accountId)
    })
    return current
  }
}

function packagedBrowserPath(root: string, platform: NodeJS.Platform, arch: string): string {
  const directory = join(root, "pigclaude-runtime", "pigbrowser", `${platform}-${arch}`)
  if (platform === "darwin") {
    return join(directory, "Chromium.app", "Contents", "MacOS", "Chromium")
  }
  return join(directory, "browser", platform === "win32" ? "chrome.exe" : "chrome")
}

function validatedNetwork(network: LaunchBrowserNetwork): LaunchBrowserNetwork {
  const mode = network?.mode
  if (mode === "system" && !("bridgeUrl" in network) && !("callbackUri" in network)) {
    return { mode: "system" }
  }
  if (mode === "bound" && "bridgeUrl" in network && "callbackUri" in network) {
    const bridgeUrl = network.bridgeUrl
    const callbackUri = network.callbackUri
    const bridgePort = localBridgePort(bridgeUrl)
    const callbackPort = managedCallbackPort(callbackUri)
    if (bridgePort !== null && callbackPort !== null && callbackPort !== bridgePort) {
      return { mode: "bound", bridgeUrl, callbackUri }
    }
    if (bridgePort !== null) {
      throw new BrowserLaunchError("BROWSER_START_FAILED", "授权回调地址无效或与代理桥端口冲突")
    }
  }
  throw new BrowserLaunchError("BROWSER_START_FAILED", "代理桥无效或网络模式不明确，请检查代理设置")
}

function buildLaunchArgs(
  network: LaunchBrowserNetwork,
  fingerprint: ClaudeFingerprintView,
  profileDir: string,
  screenSize: ScreenSize | undefined,
): string[] {
  const args = [`--user-data-dir=${profileDir}`]
  if (network.mode === "bound") {
    const callbackPort = managedCallbackPort(network.callbackUri)
    if (callbackPort === null) {
      throw new BrowserLaunchError("BROWSER_START_FAILED", "授权回调地址无效")
    }
    args.push(
      `--proxy-server=${network.bridgeUrl}`,
      `--proxy-bypass-list=<-loopback>;http://localhost:${callbackPort}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    )
    if (!fingerprint.webrtcPolicy) args.push("--disable-non-proxied-udp")
  }
  args.push(
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--remote-debugging-pipe",
    "--no-startup-window",
    ...buildFingerprintArgs(fingerprint, { screen: screenSize }),
  )
  return args
}
