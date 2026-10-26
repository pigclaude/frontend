// 负责把每次 turn 的元数据追加到 <userData>/usage.jsonl；
// 只写 token 数量、耗时和状态，不写提示词、回复正文、工具输入输出、文件路径或凭据。

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

const schemaVersion = 1
const defaultRetentionMs = 30 * 24 * 60 * 60 * 1_000
const writeFailedMessage = "用量记录写入失败"

/** 一条用量记录；字段与设计第 11 节严格一致。 */
export type UsageRecord = {
  schemaVersion: 1
  at: string
  sessionId: string
  turnId: string
  accountId: string | null
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  durationMs: number
  status: "success" | "error" | "cancelled"
  errorCode: string | null
  switchedFrom: string | null
}

/** 用量汇总的时间范围。 */
export type UsageRange = "today" | "7d"

/** usage.summary 返回的脱敏汇总。 */
export type UsageSummary = {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  averageDurationMs: number
  errors: number
}

/** 用量记录器依赖；时间、保留期和失败回调都可注入。 */
export type UsageRecorderOptions = {
  filePath: string
  now?: () => number
  retentionMs?: number
  onWriteFailed?: (message: string) => void
}

/** 只追加元数据的用量记录器。保证写入失败不抛给调用方；第一次读写前清理超过保留期的旧记录。 */
export class UsageRecorder {
  readonly #filePath: string
  readonly #now: () => number
  readonly #retentionMs: number
  readonly #listeners = new Set<(message: string) => void>()
  #cleanup: Promise<void> | null = null
  #writes: Promise<void> = Promise.resolve()

  /** 创建绑定到固定文件的记录器；文件路径由 main 进程用 userData 拼出。 */
  constructor(options: UsageRecorderOptions) {
    this.#filePath = options.filePath
    this.#now = options.now ?? Date.now
    this.#retentionMs = options.retentionMs ?? defaultRetentionMs
    if (options.onWriteFailed !== undefined) this.#listeners.add(options.onWriteFailed)
  }

  /** 订阅写入失败通知，返回取消订阅函数；通知只含固定文案，不含路径。 */
  onWriteFailed(listener: (message: string) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** 追加一条记录并等待落盘；失败只通知监听者，不抛错也不阻断会话。 */
  async record(record: UsageRecord): Promise<void> {
    await this.#cleanupOnce()
    const line = `${JSON.stringify(normalizeRecord(record, this.#now()))}\n`
    await this.#enqueue(async () => {
      await mkdir(dirname(this.#filePath), { recursive: true, mode: 0o700 })
      await appendFile(this.#filePath, line, { encoding: "utf8", mode: 0o600 })
    })
  }

  /** 汇总 today 或最近 7 天的元数据；文件缺失或损坏时返回零值，不返回任何正文。 */
  async summary(range: UsageRange): Promise<UsageSummary> {
    await this.#cleanupOnce()
    await this.#writes
    const records = await this.#readRecords()
    const start =
      range === "today" ? startOfLocalDay(this.#now()) : this.#now() - 7 * 24 * 60 * 60 * 1_000
    const selected = records.filter((record) => Date.parse(record.at) >= start)
    const totals = selected.reduce(
      (sum, record) => ({
        inputTokens: sum.inputTokens + record.inputTokens,
        outputTokens: sum.outputTokens + record.outputTokens,
        cacheReadTokens: sum.cacheReadTokens + record.cacheReadTokens,
        cacheCreationTokens: sum.cacheCreationTokens + record.cacheCreationTokens,
        durationMs: sum.durationMs + record.durationMs,
        errors: sum.errors + (record.status === "error" ? 1 : 0),
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        durationMs: 0,
        errors: 0,
      },
    )
    return {
      requests: selected.length,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      averageDurationMs:
        selected.length === 0 ? 0 : Math.round(totals.durationMs / selected.length),
      errors: totals.errors,
    }
  }

  // 每个进程只清理一次；清理失败不影响后续追加。
  #cleanupOnce(): Promise<void> {
    if (this.#cleanup === null) {
      this.#cleanup = this.#cleanupOld().catch(() => {
        this.#notify()
      })
    }
    return this.#cleanup
  }

  async #cleanupOld(): Promise<void> {
    const lines = await this.#readLines()
    if (lines.length === 0) return
    const cutoff = this.#now() - this.#retentionMs
    const kept: UsageRecord[] = []
    let dropped = false
    for (const line of lines) {
      if (line.trim() === "") {
        dropped = true
        continue
      }
      try {
        const parsed: unknown = JSON.parse(line)
        if (isUsageRecord(parsed) && Date.parse(parsed.at) >= cutoff) kept.push(parsed)
        else dropped = true
      } catch {
        dropped = true
      }
    }
    if (!dropped && kept.length === lines.length) return
    const content = kept.map((record) => `${JSON.stringify(record)}\n`).join("")
    await writeFile(this.#filePath, content, { encoding: "utf8", mode: 0o600 })
  }

  async #readRecords(): Promise<UsageRecord[]> {
    const records: UsageRecord[] = []
    for (const line of await this.#readLines()) {
      if (line.trim() === "") continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (isUsageRecord(parsed)) records.push(parsed)
      } catch {
        // 单行损坏不能影响其他记录的读取和汇总。
      }
    }
    return records
  }

  async #readLines(): Promise<string[]> {
    let content: string
    try {
      content = await readFile(this.#filePath, "utf8")
    } catch {
      return []
    }
    return content.split("\n").filter((line, index, lines) => {
      return line.trim() !== "" || index < lines.length - 1
    })
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.#writes.then(task).catch(() => {
      this.#notify()
    })
    this.#writes = next
    return next
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(writeFailedMessage)
      } catch {
        // 监听者失败不能把写入错误抛回会话。
      }
    }
  }
}

function normalizeRecord(record: UsageRecord, fallbackAt: number): UsageRecord {
  return {
    schemaVersion,
    at: isValidDate(record.at) ? record.at : new Date(fallbackAt).toISOString(),
    sessionId: readString(record.sessionId) ?? "",
    turnId: readString(record.turnId) ?? "",
    accountId: readNullableString(record.accountId),
    model: readNullableString(record.model),
    inputTokens: readCount(record.inputTokens),
    outputTokens: readCount(record.outputTokens),
    cacheReadTokens: readCount(record.cacheReadTokens),
    cacheCreationTokens: readCount(record.cacheCreationTokens),
    durationMs: readCount(record.durationMs),
    status: readStatus(record.status),
    errorCode: readNullableString(record.errorCode),
    switchedFrom: readNullableString(record.switchedFrom),
  }
}

function isUsageRecord(value: unknown): value is UsageRecord {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === schemaVersion &&
    typeof value.at === "string" &&
    isValidDate(value.at) &&
    typeof value.sessionId === "string" &&
    typeof value.turnId === "string" &&
    (value.accountId === null || typeof value.accountId === "string") &&
    (value.model === null || typeof value.model === "string") &&
    isCount(value.inputTokens) &&
    isCount(value.outputTokens) &&
    isCount(value.cacheReadTokens) &&
    isCount(value.cacheCreationTokens) &&
    isCount(value.durationMs) &&
    (value.status === "success" || value.status === "error" || value.status === "cancelled") &&
    (value.errorCode === null || typeof value.errorCode === "string") &&
    (value.switchedFrom === null || typeof value.switchedFrom === "string")
  )
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function readCount(value: number): number {
  return isCount(value) ? value : 0
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function readString(value: string): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function readNullableString(value: string | null): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function readStatus(value: UsageRecord["status"]): UsageRecord["status"] {
  return value === "error" || value === "cancelled" ? value : "success"
}

function startOfLocalDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
