// 验证会话存储的时间线：每行一个脱敏后的信封、只写要保存的事件、按序号分页读回、
// 末行不完整时跳过并在下次追加前截掉。

import { appendFile, chmod, readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SessionStore } from "./session-store"
import {
  envelopeOf,
  modeOf,
  newSessionIndex,
  removeTemporaryDirs,
  temporaryDir,
} from "./session-store-fixtures"
import { timelineContentLimitBytes } from "./session-timeline-redaction"

const posixOnly = it.skipIf(process.platform === "win32")

afterEach(removeTemporaryDirs)

async function storeWithSession(): Promise<SessionStore> {
  const store = await SessionStore.open({ root: join(await temporaryDir(), "session-store") })
  await store.create(newSessionIndex("s-1"))
  return store
}

const turnStarted = (seq: number) =>
  envelopeOf("s-1", seq, { type: "turn-started", turnId: `turn-${seq}` })

describe("SessionStore 时间线", () => {
  it("只把要保存的事件脱敏后逐行写进时间线，读回时按序号排列", async () => {
    const store = await storeWithSession()
    const long = "a".repeat(timelineContentLimitBytes + 1)

    expect(await store.appendTimeline("s-1", turnStarted(1))).toBe(true)
    expect(
      await store.appendTimeline(
        "s-1",
        envelopeOf("s-1", null, { type: "delta", text: "正在", thinking: false, blockIndex: 0 }),
      ),
    ).toBe(false)
    await store.appendTimeline(
      "s-1",
      envelopeOf("s-1", 2, {
        type: "tool-result",
        toolUseId: "t-1",
        content: long,
        isError: false,
      }),
    )

    const lines = (await readFile(store.paths("s-1").timelineFile, "utf8")).trimEnd().split("\n")
    expect(lines).toHaveLength(2)
    const page = await store.readTimeline("s-1")
    expect(page.envelopes.map((envelope) => envelope.seq)).toEqual([1, 2])
    expect(page.envelopes[1]?.truncated).toEqual([
      { path: "event.content", bytes: timelineContentLimitBytes + 1 },
    ])
    expect(page.lastSeq).toBe(2)
    expect(store.list()[0]?.timelineCursor).toBe(2)
  })

  posixOnly("时间线文件是 0600", async () => {
    const store = await storeWithSession()

    await store.appendTimeline("s-1", turnStarted(1))

    expect(await modeOf(store.paths("s-1").timelineFile)).toBe(0o600)
  })

  it("按序号分页读回：序号大于 afterSeq 的最多 limit 条", async () => {
    const store = await storeWithSession()
    for (let seq = 1; seq <= 5; seq += 1) await store.appendTimeline("s-1", turnStarted(seq))

    const page = await store.readTimeline("s-1", { afterSeq: 2, limit: 2 })

    expect(page.envelopes.map((envelope) => envelope.seq)).toEqual([3, 4])
    expect(page.lastSeq).toBe(5)
  })

  it("末行不完整时跳过它读回其余内容，下次追加前先截掉半行", async () => {
    const store = await storeWithSession()
    await store.appendTimeline("s-1", turnStarted(1))
    const file = store.paths("s-1").timelineFile
    await appendFile(file, '{"version":1,"sessionId":"s-1","seq":2,"at":"2026-11-14T08:')
    const reopened = await SessionStore.open({ root: join(file, "..", "..") })

    const before = await reopened.readTimeline("s-1")
    await reopened.appendTimeline("s-1", turnStarted(2))
    const after = await reopened.readTimeline("s-1")

    expect(before.envelopes.map((envelope) => envelope.seq)).toEqual([1])
    expect(after.envelopes.map((envelope) => envelope.seq)).toEqual([1, 2])
    expect(after.skippedLines).toBe(0)
    expect((await readFile(file, "utf8")).trimEnd().split("\n")).toHaveLength(2)
  })

  posixOnly("同一次运行里追加失败留下半行后，下次追加前先截掉它", async () => {
    const store = await storeWithSession()
    await store.appendTimeline("s-1", turnStarted(1))
    const file = store.paths("s-1").timelineFile
    await chmod(file, 0o400)
    try {
      await expect(store.appendTimeline("s-1", turnStarted(2))).rejects.toThrow()
    } finally {
      await chmod(file, 0o600)
    }
    await appendFile(file, '{"version":1,"sessionId":"s-1","seq":2,"at":"2026-11-14T08:')

    await store.appendTimeline("s-1", turnStarted(2))

    const page = await store.readTimeline("s-1")
    expect(page.envelopes.map((envelope) => envelope.seq)).toEqual([1, 2])
    expect(page.skippedLines).toBe(0)
  })

  it("中间解析不了的行跳过并计数，其余照常读回", async () => {
    const store = await storeWithSession()
    await store.appendTimeline("s-1", turnStarted(1))
    await appendFile(store.paths("s-1").timelineFile, "not json\n")
    await store.appendTimeline("s-1", turnStarted(2))

    const page = await store.readTimeline("s-1")

    expect(page.envelopes.map((envelope) => envelope.seq)).toEqual([1, 2])
    expect(page.skippedLines).toBe(1)
  })

  it("信封的会话 id 与目标会话不同或会话不存在时拒绝写入", async () => {
    const store = await storeWithSession()

    await expect(
      store.appendTimeline("s-1", envelopeOf("s-2", 1, { type: "turn-started", turnId: "t" })),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" })
    await expect(store.appendTimeline("missing", turnStarted(1))).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    })
  })
})
