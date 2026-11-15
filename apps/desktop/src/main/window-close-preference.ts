// 负责关窗偏好的本机读写和 IPC。只有受信主窗口可以读取和修改；写入完成后才切换行为。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { IpcMain, IpcMainInvokeEvent } from "electron"

/** 持久化关窗行为；macOS 与 Windows 默认隐藏，Linux 默认退出。 */
export class WindowClosePreference {
  #current: boolean
  #writes: Promise<unknown>
  readonly #ready: Promise<void>

  /** 从固定的本机文件读取偏好；不存在或不合法时使用该平台的默认值。 */
  constructor(
    private readonly filePath: string,
    platform: NodeJS.Platform,
  ) {
    this.#current = platform === "darwin" || platform === "win32"
    this.#ready = this.#load()
    this.#writes = this.#ready
  }

  /** 返回当前关窗行为，供必须同步决定的原生窗口事件使用。 */
  current(): boolean {
    return this.#current
  }

  /** 等待首次读取后返回关窗行为。 */
  async get(): Promise<boolean> {
    await this.#ready
    return this.#current
  }

  /** 顺序保存修改，返回写入成功的值；失败保留此前设置。 */
  set(value: boolean): Promise<boolean> {
    const write = this.#writes.then(async () => {
      const temporary = `${this.filePath}.${randomUUID()}.tmp`
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      try {
        await writeFile(temporary, JSON.stringify({ closeToTray: value }), {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        })
        await rename(temporary, this.filePath)
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      this.#current = value
      return value
    })
    this.#writes = write.catch(() => undefined)
    return write
  }

  async #load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, "utf8"))
      if (
        value &&
        typeof value === "object" &&
        "closeToTray" in value &&
        typeof value.closeToTray === "boolean"
      )
        this.#current = value.closeToTray
    } catch {
      // 没有可用的本机记录时照常启动。
    }
  }
}

/** 注册关窗偏好桥；只接受受信窗口和布尔值，不传递本机文件位置。 */
export function registerWindowClosePreference(
  ipc: Pick<IpcMain, "handle">,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  preference: WindowClosePreference,
): void {
  ipc.handle("pigclaude:window-close-to-tray-get", (event) => {
    if (!trusted(event)) throw new Error("UNTRUSTED_WINDOW_REQUEST")
    return preference.get()
  })
  ipc.handle("pigclaude:window-close-to-tray-set", async (event, value: unknown) => {
    if (!trusted(event)) throw new Error("UNTRUSTED_WINDOW_REQUEST")
    if (typeof value !== "boolean") throw new Error("WINDOW_PREFERENCE_INVALID")
    return preference.set(value).catch(() => {
      throw new Error("WINDOW_PREFERENCE_FAILED")
    })
  })
}
