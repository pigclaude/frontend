// 负责验证用量记录的字段、只写元数据、30 天清理、汇总和写入失败不阻断。

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { UsageRecorder, type UsageRecord } from "./usage-recorder"

const temporaryDirs: string[] = []
const now = new Date(2026, 9, 26, 12, 0, 0).getTime()

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("UsageRecorder", () => {
  it("appends exactly the metadata fields defined by the design", async () => {
    const filePath = await usageFile()
    const recorder = new UsageRecorder({ filePath, now: () => now })
    const record = sampleRecord()

    await recorder.record(record)

    const lines = (await readFile(filePath, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      schemaVersion: 1,
      at: new Date(now).toISOString(),
      sessionId: "session-1",
      turnId: "turn-1",
      accountId: "account-a",
      model: "claude-sonnet-4",
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      durationMs: 1_200,
      status: "success",
      errorCode: null,
      switchedFrom: null,
    })
  })

  it("never persists prompts, replies or credentials even when a caller passes them", async () => {
    const filePath = await usageFile()
    const recorder = new UsageRecorder({ filePath, now: () => now })
    const withSecrets = {
      ...sampleRecord(),
      prompt: "top secret prompt",
      reply: "top secret reply",
      accessToken: "sk-ant-secret",
      proxyUrl: "http://user:proxy-password@proxy.example",
    } as unknown as UsageRecord

    await recorder.record(withSecrets)

    const content = await readFile(filePath, "utf8")
    expect(content).not.toContain("top secret")
    expect(content).not.toContain("sk-ant-secret")
    expect(content).not.toContain("proxy-password")
    expect(Object.keys(JSON.parse(content.trim()))).toHaveLength(14)
  })

  it("removes records older than thirty days before appending", async () => {
    const filePath = await usageFile()
    const oldRecord = sampleRecord({
      at: new Date(now - 31 * 24 * 60 * 60 * 1_000).toISOString(),
      turnId: "turn-old",
    })
    const recentRecord = sampleRecord({
      at: new Date(now - 29 * 24 * 60 * 60 * 1_000).toISOString(),
      turnId: "turn-recent",
    })
    await writeFile(filePath, `${JSON.stringify(oldRecord)}\n${JSON.stringify(recentRecord)}\n`)

    const recorder = new UsageRecorder({ filePath, now: () => now })
    await recorder.record(sampleRecord({ turnId: "turn-new" }))

    const records = parseLines(await readFile(filePath, "utf8"))
    expect(records.map((record) => record.turnId)).toEqual(["turn-recent", "turn-new"])
  })

  it("summarizes today and the last seven days without exposing records", async () => {
    const filePath = await usageFile()
    const recorder = new UsageRecorder({ filePath, now: () => now })
    const today = new Date(2026, 9, 26, 9, 0, 0).toISOString()
    const yesterday = new Date(2026, 9, 25, 9, 0, 0).toISOString()
    const eightDaysAgo = new Date(2026, 9, 18, 9, 0, 0).toISOString()

    await recorder.record(
      sampleRecord({
        at: today,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
        durationMs: 1_000,
      }),
    )
    await recorder.record(
      sampleRecord({
        at: yesterday,
        inputTokens: 30,
        outputTokens: 40,
        cacheReadTokens: 5,
        cacheCreationTokens: 6,
        durationMs: 3_000,
        status: "error",
        errorCode: "SDK_ERROR",
      }),
    )
    await recorder.record(sampleRecord({ at: eightDaysAgo, inputTokens: 100 }))

    await expect(recorder.summary("today")).resolves.toEqual({
      requests: 1,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      averageDurationMs: 1_000,
      errors: 0,
    })
    expect(await recorder.summary("7d")).toEqual({
      requests: 2,
      inputTokens: 40,
      outputTokens: 60,
      cacheReadTokens: 8,
      cacheCreationTokens: 10,
      averageDurationMs: 2_000,
      errors: 1,
    })
  })

  it("does not block the caller when the usage file cannot be written", async () => {
    const directory = await tempDir()
    const blockingFile = join(directory, "not-a-directory")
    await writeFile(blockingFile, "x")
    const failures: string[] = []
    const recorder = new UsageRecorder({
      filePath: join(blockingFile, "usage.jsonl"),
      now: () => now,
      onWriteFailed: (message) => failures.push(message),
    })

    await expect(recorder.record(sampleRecord())).resolves.toBeUndefined()
    expect(failures).toHaveLength(1)
    expect(failures[0]).not.toContain(blockingFile)
    expect(await recorder.summary("today")).toEqual({
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      averageDurationMs: 0,
      errors: 0,
    })
  })

  it("ignores malformed lines when reading and cleaning", async () => {
    const filePath = await usageFile()
    await writeFile(filePath, 'not-json\n{"schemaVersion":1}\n')

    const recorder = new UsageRecorder({ filePath, now: () => now })
    await recorder.record(sampleRecord())

    const records = parseLines(await readFile(filePath, "utf8"))
    expect(records).toHaveLength(1)
    expect(records[0]?.turnId).toBe("turn-1")
  })

  it("serializes concurrent records so no line is lost", async () => {
    const filePath = await usageFile()
    const recorder = new UsageRecorder({ filePath, now: () => now })

    await Promise.all([
      recorder.record(sampleRecord({ turnId: "turn-a" })),
      recorder.record(sampleRecord({ turnId: "turn-b" })),
      recorder.record(sampleRecord({ turnId: "turn-c" })),
    ])

    expect(parseLines(await readFile(filePath, "utf8")).map((record) => record.turnId)).toEqual([
      "turn-a",
      "turn-b",
      "turn-c",
    ])
  })
})

function sampleRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    schemaVersion: 1,
    at: new Date(now).toISOString(),
    sessionId: "session-1",
    turnId: "turn-1",
    accountId: "account-a",
    model: "claude-sonnet-4",
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    durationMs: 1_200,
    status: "success",
    errorCode: null,
    switchedFrom: null,
    ...overrides,
  }
}

function parseLines(content: string): UsageRecord[] {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as UsageRecord)
}

async function usageFile(): Promise<string> {
  return join(await tempDir(), "usage.jsonl")
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-usage-"))
  temporaryDirs.push(dir)
  return dir
}
