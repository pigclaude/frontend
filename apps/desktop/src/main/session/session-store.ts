// 负责会话存储的对外接口：打开时扫描根目录建内存索引，新建会话目录，读写索引。
// 同一会话的写入排队串行；不调用 SDK 的会话函数，也不读 ~/.claude。

import { chmod, mkdir, readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { errorMessage } from "../error-message"
import { readSessionIndexFile, writeSessionIndexFile } from "./session-index-file"
import { removeIndexTemporaryFiles, removeOrphanDirectory } from "./session-store-cleanup"
import { recoverSession } from "./session-store-recovery"
import { sessionIndexRecord, type SessionIndex } from "./session-index"
import {
  isSessionStoreId,
  sessionStoreDirMode,
  sessionStorePaths,
  type SessionStorePaths,
} from "./session-store-layout"
import { SessionHostError } from "./session-types"
import type { SessionEnvelope } from "./session-envelope"
import { maxEnvelopesPerRead, type SessionEventCursor } from "./session-event-log"
import { normalizeHistory } from "./session-history"
import {
  appendTimelineFile,
  readTimelineFile,
  repairTimelineTail,
  type TimelineFileRead,
} from "./session-timeline-file"
import { timelineEnvelope, type TimelineEnvelope } from "./session-timeline-redaction"

/** 新建会话时由调用方给出的索引；时间线游标由存储从 0 开始维护。 */
export type NewSessionIndex = Omit<SessionIndex, "timelineCursor">

/** 索引的局部修改；id、创建时间和时间线游标不能改。没给 updatedAt 时存储用当前时间。 */
export type SessionIndexPatch = Partial<Omit<SessionIndex, "id" | "createdAt" | "timelineCursor">>

/** 打开存储的输入。now 是注入的时钟，log 记录跳过的目录和清理失败，不含会话内容。 */
export type SessionStoreOptions = {
  root: string
  now?: () => number
  log?: (message: string) => void
}

/** 读时间线的范围：序号大于 afterSeq 的最多 limit 条。 */
export type TimelineRange = { afterSeq?: number; limit?: number }

/** 读回的一页时间线：按序号排列；lastSeq 是整条时间线的最大序号，skippedLines 是跳过的损坏行数。 */
export type TimelinePage = {
  envelopes: TimelineEnvelope[]
  lastSeq: number
  skippedLines: number
}

type Entry = { index: SessionIndex; raw: Record<string, unknown> }

/** 本机会话存储。保证内存索引和磁盘一致，同一会话的写入按调用顺序串行。 */
export class SessionStore {
  readonly #root: string
  readonly #now: () => number
  readonly #log: (message: string) => void
  readonly #entries = new Map<string, Entry>()
  readonly #queues = new Map<string, Promise<unknown>>()
  readonly #repairedTimelines = new Set<string>()

  private constructor(options: SessionStoreOptions) {
    this.#root = options.root
    this.#now = options.now ?? Date.now
    this.#log = options.log ?? ((message) => console.warn(message))
  }

  /**
   * 打开存储：建好 0700 的根目录，扫描每个会话目录建内存索引，清掉残留的索引临时文件，
   * 删除没有索引且超过 1 小时的目录。单个目录处理失败只记日志，不影响其他会话。
   */
  static async open(options: SessionStoreOptions): Promise<SessionStore> {
    const store = new SessionStore(options)
    await mkdir(options.root, { recursive: true, mode: sessionStoreDirMode })
    await chmod(options.root, sessionStoreDirMode)
    for (const entry of await readdir(options.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      await store.#scan(entry.name).catch((error: unknown) => {
        store.#log(`会话目录 ${entry.name} 处理失败：${errorMessage(error)}`)
      })
    }
    return store
  }

  /** 会话目录各部分的路径；id 不合法时抛错。 */
  paths(id: string): SessionStorePaths {
    return sessionStorePaths(this.#root, id)
  }

  /** 内存索引里的全部会话（副本）。 */
  list(): SessionIndex[] {
    return [...this.#entries.values()].map((entry) => structuredClone(entry.index))
  }

  /** 读一个会话的索引副本；找不到时返回 null。 */
  get(id: string): SessionIndex | null {
    const entry = this.#entries.get(id)
    return entry === undefined ? null : structuredClone(entry.index)
  }

  /** 新建 0700 的会话目录并写第一份索引；目录已存在时抛错，不覆盖。 */
  async create(input: NewSessionIndex): Promise<SessionIndex> {
    const paths = this.paths(input.id)
    const index: SessionIndex = { ...structuredClone(input), timelineCursor: 0 }
    await mkdir(paths.directory, { mode: sessionStoreDirMode })
    await chmod(paths.directory, sessionStoreDirMode)
    const raw = sessionIndexRecord({}, index)
    await writeSessionIndexFile(paths.indexFile, raw)
    this.#entries.set(index.id, { index, raw })
    return structuredClone(index)
  }

  /** 按会话 id 局部更新索引并原子写回；不认识的字段保留。会话不存在时报 SESSION_NOT_FOUND。 */
  update(id: string, patch: SessionIndexPatch): Promise<SessionIndex> {
    return this.#enqueue(id, async () => {
      const index: SessionIndex = {
        ...this.#entry(id).index,
        updatedAt: new Date(this.#now()).toISOString(),
        ...structuredClone(patch),
      }
      await this.#write(id, index)
      return structuredClone(index)
    })
  }

  /**
   * 往时间线追加一条信封：只用于实时的事件不写、返回 false；要保存的事件先脱敏截断再写，返回 true，
   * 并把内存索引的时间线游标推到这条的序号（下次写索引时落盘）。信封的会话 id 必须是目标会话。
   */
  appendTimeline(id: string, envelope: SessionEnvelope): Promise<boolean> {
    return this.#enqueue(id, async () => {
      const entry = this.#entry(id)
      if (envelope.sessionId !== id)
        throw new SessionHostError("SESSION_NOT_FOUND", "信封不属于这个会话")
      const line = timelineEnvelope(envelope)
      if (line === null || line.seq === null) return false
      await this.#appendLines(id, [line])
      entry.index = {
        ...entry.index,
        timelineCursor: Math.max(entry.index.timelineCursor, line.seq),
      }
      return true
    })
  }

  /** 从已写入磁盘的完整信封取序号和时间上界，不依赖索引里可能滞后的游标。 */
  cursor(id: string): Promise<SessionEventCursor> {
    return this.#enqueue(id, async () => {
      this.#entry(id)
      const { envelopes } = await this.#readTimeline(id)
      let lastAt = Number.NEGATIVE_INFINITY
      for (const { at } of envelopes) {
        const time = Date.parse(at)
        if (Number.isFinite(time)) lastAt = Math.max(lastAt, time)
      }
      return { seq: lastSeqOf(envelopes), at: Number.isFinite(lastAt) ? lastAt : 0 }
    })
  }

  /** 读回时间线里序号大于 afterSeq 的最多 limit 条（默认 0 和 maxEnvelopesPerRead），跳过不完整的末行。 */
  readTimeline(id: string, range: TimelineRange = {}): Promise<TimelinePage> {
    return this.#enqueue(id, async () => {
      this.#entry(id)
      const afterSeq = range.afterSeq ?? 0
      const limit = range.limit ?? maxEnvelopesPerRead
      const read = await this.#readTimeline(id)
      const compatible = normalizeHistory(read.envelopes)
      const envelopes = compatible
        .filter((envelope) => (envelope.seq ?? 0) > afterSeq)
        .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
        .slice(0, limit)
      return {
        envelopes,
        lastSeq: lastSeqOf(read.envelopes),
        skippedLines: read.skippedLines + read.envelopes.length - compatible.length,
      }
    })
  }

  /** 删除整个会话目录（含 Claude Code 配置目录和临时目录）并移出内存索引。 */
  delete(id: string): Promise<void> {
    return this.#enqueue(id, async () => {
      this.#entry(id)
      await rm(this.paths(id).directory, { recursive: true, force: true })
      this.#entries.delete(id)
      this.#repairedTimelines.delete(id)
    })
  }

  async #scan(name: string): Promise<void> {
    const read = isSessionStoreId(name)
      ? await readSessionIndexFile(this.paths(name).indexFile)
      : ({ kind: "missing" } as const)
    if (read.kind === "missing") {
      if (await removeOrphanDirectory(join(this.#root, name), this.#now()))
        this.#log(`已删除没有索引的会话目录 ${name}`)
      return
    }
    const id = name
    if (read.kind === "newer") {
      this.#log(`会话 ${id} 的索引格式版本 ${read.version} 比本版本新，已跳过`)
      return
    }
    if (read.kind === "invalid" || read.index.id !== id) {
      this.#log(`会话 ${id} 的索引无法解析，已跳过`)
      return
    }
    await removeIndexTemporaryFiles(this.paths(id).directory)
    this.#entries.set(id, { index: read.index, raw: read.raw })
    if (read.index.status !== "running") return
    try {
      await this.#recover(id)
    } catch (error: unknown) {
      this.#entries.delete(id)
      throw error
    }
  }

  async #recover(id: string): Promise<void> {
    const now = this.#now()
    const timeline = (await this.#readTimeline(id)).envelopes
    const recovery = recoverSession(id, timeline, now)
    const lines = recovery.envelopes.flatMap((envelope) => timelineEnvelope(envelope) ?? [])
    await this.#appendLines(id, lines)
    const { index } = this.#entry(id)
    await this.#write(id, {
      ...index,
      status: recovery.status,
      ...(recovery.status === "interrupted" ? { lastTurn: recovery.lastTurn } : {}),
      updatedAt: new Date(now).toISOString(),
      timelineCursor: lastSeqOf([...timeline, ...lines]),
    })
  }

  async #write(id: string, index: SessionIndex): Promise<void> {
    const raw = sessionIndexRecord(this.#entry(id).raw, index)
    await writeSessionIndexFile(this.paths(id).indexFile, raw)
    this.#entries.set(id, { index, raw })
  }

  async #readTimeline(id: string): Promise<TimelineFileRead> {
    const read = await readTimelineFile(this.paths(id).timelineFile)
    const envelopes = read.envelopes.filter((envelope) => envelope.sessionId === id)
    return {
      ...read,
      envelopes,
      skippedLines: read.skippedLines + read.envelopes.length - envelopes.length,
    }
  }

  async #appendLines(id: string, lines: readonly TimelineEnvelope[]): Promise<void> {
    const file = this.paths(id).timelineFile
    if (!this.#repairedTimelines.has(id)) {
      await repairTimelineTail(file)
      this.#repairedTimelines.add(id)
    }
    try {
      await appendTimelineFile(file, lines)
    } catch (error: unknown) {
      this.#repairedTimelines.delete(id)
      throw error
    }
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id)
    if (!entry) throw new SessionHostError("SESSION_NOT_FOUND", "会话不存在")
    return entry
  }

  #enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const next = (this.#queues.get(id) ?? Promise.resolve()).then(task, task)
    this.#queues.set(
      id,
      next.catch(() => undefined),
    )
    return next
  }
}

function lastSeqOf(envelopes: readonly TimelineEnvelope[]): number {
  return envelopes.reduce((last, envelope) => Math.max(last, envelope.seq ?? 0), 0)
}
