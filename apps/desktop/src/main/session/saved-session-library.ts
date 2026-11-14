// 负责会话历史操作和保留期清理，删除前与会话宿主一起关闭进程并等待最后的磁盘写入。

import { lstat, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { SessionHistoryStats, SessionRetention } from "../../session-history-contract"
import { reapRetainedClaudeProcess } from "./retained-claude-process"
import type { SessionTimers } from "./session-host-active"
import type { SessionPersistence } from "./session-persistence"
import type { SessionStore } from "./session-store"
import { fileErrorCode } from "./session-store-guards"
import { SessionHostError, type SessionHostEvent } from "./session-types"
import { SessionRetentionStore } from "./session-retention-store"

const sweepInterval = 60 * 60_000
const dayMs = 24 * sweepInterval

/** 管理已保存会话所需的宿主操作。 */
export type SavedSessionLibraryOptions = {
  persistence: SessionPersistence | null
  userDataPath: string
  now: () => number
  timers: SessionTimers
  authorize: () => void
  /** 停放指定会话，或停放全部会话，并等待已发起的启动请求收尾。 */
  stop: (id?: string) => Promise<void>
  /** 会话在启动、排队或运行时，保留期清理跳过。 */
  active: (id: string) => boolean
  removed: (id: string) => void
  notify: (event: SessionHostEvent) => void
}

/** 对已保存的会话提供索引修改、占用统计、删除和定时清理。 */
export class SavedSessionLibrary {
  readonly #retention: SessionRetentionStore
  readonly #deleting = new Map<string, Promise<void>>()
  #clearing: Promise<void> | null = null
  #sweep: Promise<void> | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #disposed = false
  #retentionRevision = 0

  /** 绑定存储和会话生命周期；首次读取自动保留期不阻塞应用启动。 */
  constructor(private readonly options: SavedSessionLibraryOptions) {
    this.#retention = new SessionRetentionStore(options.userDataPath)
    if (options.persistence !== null) this.#schedule()
  }

  /** 删除中的会话不可启动或写入；清除全部时暂停创建新会话。 */
  assertWritable(id: string, rejected?: () => void): void {
    if (this.#clearing !== null || this.#deleting.has(id)) {
      rejected?.()
      throw new SessionHostError("SESSION_CANCELLED", "会话正在删除")
    }
  }

  /** 更新用户指定的标题，后续自动标题不得覆盖。 */
  async rename(id: string, title: string): Promise<void> {
    const store = await this.#authorizedStore()
    this.assertWritable(id)
    await store.update(id, { title, titleSource: "user" })
    this.options.notify({ type: "sessions-changed" })
  }

  /** 修改归档时间；归档后仍可从已归档列表打开。 */
  async archive(id: string, archived: boolean): Promise<void> {
    const store = await this.#authorizedStore()
    this.assertWritable(id)
    await store.update(id, {
      archivedAt: archived ? new Date(this.options.now()).toISOString() : null,
    })
    this.options.notify({ type: "sessions-changed" })
  }

  /** 停放一个会话，再删除它的索引、时间线、Claude 配置和临时目录。 */
  async delete(id: string): Promise<void> {
    const store = await this.#authorizedStore()
    if (this.#clearing !== null) return this.#clearing
    if (!store.get(id)) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
    return this.#delete(store, id)
  }

  /** 停放并删除全部已保存的会话，等待尾部磁盘写入和进程退出。 */
  async clear(): Promise<void> {
    const store = await this.#authorizedStore()
    if (this.#clearing !== null) return this.#clearing
    const task = Promise.resolve()
      .then(async () => {
        await this.options.stop()
        for (const index of store.list()) await this.#delete(store, index.id)
      })
      .finally(() => {
        this.#clearing = null
        this.options.notify({ type: "sessions-changed" })
      })
    this.#clearing = task
    return task
  }

  /** 统计已保存会话的全部普通文件，符号链接不计入也不跟随。 */
  async stats(): Promise<SessionHistoryStats> {
    const store = await this.#authorizedStore()
    const indexes = store.list()
    let bytes = 0
    for (const { id } of indexes) bytes += await directorySize(store.paths(id).directory)
    return { count: indexes.length, bytes }
  }

  /** 读取自动保留期；默认关闭。 */
  retention(): Promise<SessionRetention> {
    this.options.authorize()
    return this.#retention.get()
  }

  /** 修改保留期并安排一次清理；如已停放会话到期，则按相同删除顺序处理。 */
  async setRetention(days: number | null): Promise<SessionRetention> {
    await this.#authorizedStore()
    const revision = ++this.#retentionRevision
    const setting = await this.#retention.update(days)
    await this.#sweep?.catch(() => undefined)
    if (revision === this.#retentionRevision && days !== null) {
      await this.sweep().catch(() => this.#warn())
    }
    return setting
  }

  /** 清理超过保留天数的已停止会话；运行、启动或排队中的会话继续保留。 */
  sweep(): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    if (this.#sweep !== null) return this.#sweep
    const task = this.#sweepExpired().finally(() => {
      this.#sweep = null
    })
    this.#sweep = task
    return task
  }

  /** 停止安排自动清理，等待在途删除结束。 */
  async dispose(): Promise<void> {
    this.#disposed = true
    if (this.#timer !== null) this.options.timers.clear(this.#timer)
    await Promise.allSettled([this.#sweep, this.#clearing, ...this.#deleting.values()])
  }

  async #authorizedStore(): Promise<SessionStore> {
    this.options.authorize()
    const store = await this.options.persistence?.ready
    this.options.authorize()
    if (!store || this.#disposed) throw new SessionHostError("SDK_ERROR", "会话存储不可用")
    return store
  }

  #delete(store: SessionStore, id: string): Promise<void> {
    const previous = this.#deleting.get(id)
    if (previous !== undefined) return previous
    const task = Promise.resolve()
      .then(async () => {
        await this.options.stop(id)
        await this.options.persistence?.flush(id)
        if (!store.get(id)) return
        await reapRetainedClaudeProcess(store.paths(id).directory)
        await store.delete(id)
        this.options.removed(id)
        this.options.notify({ type: "sessions-changed" })
      })
      .finally(() => {
        this.#deleting.delete(id)
      })
    this.#deleting.set(id, task)
    return task
  }

  #schedule(): void {
    if (this.#disposed) return
    void this.sweep()
      .catch(() => this.#warn())
      .finally(() => {
        if (!this.#disposed) {
          this.#timer = this.options.timers.set(() => this.#schedule(), sweepInterval)
          this.#timer.unref?.()
        }
      })
  }

  async #sweepExpired(): Promise<void> {
    const revision = this.#retentionRevision
    const store = await this.options.persistence?.ready
    if (!store) return
    const { days } = await this.#retention.get()
    if (days === null) return
    const cutoff = this.options.now() - days * dayMs
    for (const index of store.list()) {
      if (this.#disposed || this.#clearing !== null || revision !== this.#retentionRevision) return
      if (Date.parse(index.lastActivityAt) < cutoff && !this.options.active(index.id)) {
        await this.#delete(store, index.id).catch(() => this.#warn())
      }
    }
  }

  #warn(): void {
    this.options.notify({ type: "notice", message: "清理过期会话失败" })
  }
}

async function directorySize(directory: string): Promise<number> {
  try {
    let bytes = 0
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) bytes += await directorySize(path)
      else if (entry.isFile()) {
        const file = await lstat(path)
        if (file.isFile()) bytes += file.size
      }
    }
    return bytes
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT") return 0
    throw error
  }
}
