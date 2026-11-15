// 让自动启动的首个窗口保持隐藏，并在唤回后恢复 macOS Dock 偏好。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { StartupPreference, StartupPreferencesView } from "../startup-preferences-contract"
import { hasAutostartArgument, type LoginStartup } from "./login-startup"

type StartupWindow = {
  once(event: "show" | "ready-to-show", listener: () => void): unknown
  show(): void
}
type DockPreference = { filePath: string; apply(visible: boolean): void | Promise<void> }

/** 系统登录项是实际自启状态。本机文件只保存 macOS 的 Dock 选择。 */
export class StartupPreferences {
  #showInDock = true
  #hideFirstWindow = false
  #dockSuppressed = false
  #openRequested = false
  #writes: Promise<unknown> = Promise.resolve()

  /** 绑定当前系统的登记端口，非 macOS 不提供 Dock 设置。 */
  constructor(
    private readonly login: LoginStartup,
    private readonly dock: DockPreference | null,
  ) {}

  /** 在创建主窗口前读取启动来源和本机偏好。系统读取失败时照常启动。 */
  async prepare(argv: readonly string[]): Promise<void> {
    try {
      this.#hideFirstWindow = this.login.openedAutomatically(argv)
    } catch {
      console.error("STARTUP_ORIGIN_READ_FAILED")
    }
    if (this.dock === null) return
    this.#showInDock = await readDock(this.dock.filePath)
    this.#dockSuppressed = this.#hideFirstWindow && !this.#openRequested
    await this.#applyDock(this.#showInDock).catch(reportDockFailure)
  }

  /** 只让首个登录启动窗口停留在后台，用户主动唤回后恢复其 Dock 选择。 */
  attachWindow(window: StartupWindow): void {
    const hidden = this.#hideFirstWindow && !this.#openRequested
    this.#hideFirstWindow = false
    if (this.#dockSuppressed) window.once("show", () => this.#restoreDock())
    if (!hidden) window.once("ready-to-show", () => window.show())
  }

  /** 正常再次启动可唤回主窗口。启动项重复执行不会唤醒已有窗口。 */
  reopenFromSecondInstance(argv: readonly string[], restore: () => unknown): void {
    if (hasAutostartArgument(argv)) return
    this.#openRequested = true
    restore()
  }

  /** 返回刚读取的系统自启状态及生效的本机 Dock 偏好。 */
  async get(): Promise<StartupPreferencesView> {
    await this.#writes
    return {
      openAtLogin: await this.login.enabled(),
      showInDock: this.dock === null ? null : this.#showInDock,
    }
  }

  /** 串行执行用户修改，保存失败时保留已确认的设置。 */
  set(preference: StartupPreference, value: boolean): Promise<boolean> {
    const result = this.#writes.then(() =>
      preference === "openAtLogin" ? this.login.set(value) : this.#setDock(value),
    )
    this.#writes = result.catch(() => undefined)
    return result
  }

  async #setDock(value: boolean): Promise<boolean> {
    if (this.dock === null) throw new Error("STARTUP_DOCK_UNAVAILABLE")
    if (value === this.#showInDock) return value
    await this.#applyDock(value)
    try {
      await saveDock(this.dock.filePath, value)
    } catch (error) {
      await this.#applyDock(this.#showInDock).catch(reportDockFailure)
      throw error
    }
    this.#showInDock = value
    return value
  }

  #restoreDock(): void {
    this.#dockSuppressed = false
    this.#writes = this.#writes
      .then(() => this.#applyDock(this.#showInDock))
      .catch(reportDockFailure)
  }

  async #applyDock(visible: boolean): Promise<void> {
    await this.dock?.apply(visible && !this.#dockSuppressed)
  }
}

function reportDockFailure(): void {
  console.error("STARTUP_DOCK_VISIBILITY_FAILED")
}

async function readDock(filePath: string): Promise<boolean> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"))
    return !(
      typeof value === "object" &&
      value !== null &&
      "showInDock" in value &&
      value.showInDock === false
    )
  } catch {
    return true
  }
}

async function saveDock(filePath: string, showInDock: boolean): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, JSON.stringify({ showInDock }), { mode: 0o600, flag: "wx" })
    await rename(temporary, filePath)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
