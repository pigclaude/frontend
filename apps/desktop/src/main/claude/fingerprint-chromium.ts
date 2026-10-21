// 负责直接启动 fingerprint-chromium 内核：每个账号一个 user-data-dir，CLI 传指纹和代理。

import { spawn, type ChildProcess } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { buildFingerprintArgs } from "./fingerprint-args"

const defaultStopTimeoutMs = 3_000

/** 浏览器启动器的稳定错误码。 */
export type BrowserErrorCode =
  | "BROWSER_MISSING"
  | "BROWSER_START_FAILED"
  | "BROWSER_STOP_FAILED"
  | "BROWSER_PROFILE_DELETE_FAILED"

/** fingerprint-chromium 启动错误。保证错误消息不含凭据。 */
export class BrowserLaunchError extends Error {
  readonly code: BrowserErrorCode

  /** 创建带错误码的浏览器启动错误。 */
  constructor(code: BrowserErrorCode, message: string) {
    super(message)
    this.name = "BrowserLaunchError"
    this.code = code
  }
}

/** 启动器配置。binaryPath 优先，其次读取 PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN。 */
export type FingerprintChromiumConfig = {
  binaryPath?: string
  profilesRoot: string
  env?: Record<string, string | undefined>
  homeDir?: string
  spawn?: typeof spawn
  stopTimeoutMs?: number
}

/** 启动一次登录需要的输入。 */
export type LaunchBrowserInput = {
  accountId: string
  authorizeUrl: string
  bridgeUrl: string
  fingerprint: ClaudeFingerprintView
}

/** 一次成功启动的结果。 */
export type LaunchedBrowser = {
  profileDir: string
  pid: number | null
}

type ManagedProcess = {
  child: ChildProcess
  exited: Promise<void>
}

/** 直接调用 fingerprint-chromium 的启动器。保证进程和配置目录都绑定到单个账号。 */
export class FingerprintChromiumAdapter {
  readonly #binaryPath: string | undefined
  readonly #profilesRoot: string
  readonly #env: Record<string, string | undefined>
  readonly #homeDir: string
  readonly #spawn: typeof spawn
  readonly #stopTimeoutMs: number
  readonly #processes = new Map<string, ManagedProcess>()

  /** 创建绑定到账号配置根目录的启动器。 */
  constructor(config: FingerprintChromiumConfig) {
    this.#binaryPath = config.binaryPath
    this.#profilesRoot = config.profilesRoot
    this.#env = config.env ?? process.env
    this.#homeDir = config.homeDir ?? homedir()
    this.#spawn = config.spawn ?? spawn
    this.#stopTimeoutMs = config.stopTimeoutMs ?? defaultStopTimeoutMs
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
    const configured = this.#binaryPath ?? this.#env["PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN"]
    const candidates =
      configured !== undefined && configured !== ""
        ? [configured]
        : [
            "/Applications/fingerprint-chromium.app/Contents/MacOS/Chromium",
            join(this.#homeDir, "Applications/fingerprint-chromium.app/Contents/MacOS/Chromium"),
          ]
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // 继续检查下一个候选。
      }
    }
    throw new BrowserLaunchError(
      "BROWSER_MISSING",
      "找不到 fingerprint-chromium 内核；设置 PIGCLAUDE_FINGERPRINT_CHROMIUM_BIN",
    )
  }

  /** 启动内核并打开授权 URL。保证同一账号旧的浏览器进程先被停止。 */
  async launch(input: LaunchBrowserInput): Promise<LaunchedBrowser> {
    const binary = await this.ensureAvailable()
    await this.stop(input.accountId)
    const profileDir = this.profileDir(input.accountId)
    await mkdir(profileDir, { recursive: true, mode: 0o700 })
    const args = buildLaunchArgs(input, profileDir)
    let child: ChildProcess
    try {
      child = this.#spawn(binary, args, { detached: true, stdio: "ignore" })
      await waitForSpawn(child)
    } catch {
      throw new BrowserLaunchError("BROWSER_START_FAILED", "启动指纹浏览器失败")
    }
    child.unref()
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve())
    })
    this.#processes.set(input.accountId, { child, exited })
    void exited.then(() => {
      if (this.#processes.get(input.accountId)?.child === child) {
        this.#processes.delete(input.accountId)
      }
    })
    return { profileDir, pid: child.pid ?? null }
  }

  /** 停止账号的浏览器进程。保证先 SIGTERM，超时后 SIGKILL。 */
  async stop(accountId: string): Promise<void> {
    const managed = this.#processes.get(accountId)
    if (managed === undefined) return
    this.#processes.delete(accountId)
    try {
      managed.child.kill("SIGTERM")
      const timedOut = await Promise.race([
        managed.exited.then(() => false),
        delay(this.#stopTimeoutMs).then(() => true),
      ])
      if (!timedOut) return
      managed.child.kill("SIGKILL")
      await Promise.race([managed.exited, delay(1_000)])
    } catch {
      throw new BrowserLaunchError("BROWSER_STOP_FAILED", "停止指纹浏览器失败")
    }
  }

  /** 删除账号的浏览器配置目录。保证先停止进程，且只删除 profilesRoot 下的目录。 */
  async deleteProfile(accountId: string): Promise<void> {
    await this.stop(accountId)
    const dir = this.profileDir(accountId)
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      throw new BrowserLaunchError("BROWSER_PROFILE_DELETE_FAILED", "删除浏览器配置目录失败")
    }
  }

  /** 停止全部由本进程启动的浏览器。 */
  async stopAll(): Promise<void> {
    await Promise.all([...this.#processes.keys()].map((accountId) => this.stop(accountId)))
  }

  /** 释放所有浏览器进程。 */
  async dispose(): Promise<void> {
    await this.stopAll()
  }
}

function buildLaunchArgs(input: LaunchBrowserInput, profileDir: string): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    `--proxy-server=${input.bridgeUrl}`,
    "--proxy-bypass-list=localhost;127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    ...buildFingerprintArgs(input.fingerprint),
    input.authorizeUrl,
  ]
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      child.off("error", onError)
      resolve()
    }
    const onError = (): void => {
      child.off("spawn", onSpawn)
      reject(new Error("spawn failed"))
    }
    child.once("spawn", onSpawn)
    child.once("error", onError)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
