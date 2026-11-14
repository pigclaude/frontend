// 验证会话存储的时间线：每行一个脱敏后的信封、只写要保存的事件、按序号分页读回、
// 末行不完整时跳过并在下次追加前截掉。

import { appendFile, chmod, readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { maxEnvelopesPerRead, SessionEventLog } from "./session-event-log"
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
        subagent: null,
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

  it("从磁盘最高序号延续日志，不受滞后的索引或倒退的时钟影响", async () => {
    const store = await storeWithSession()
    const { timelineFile } = store.paths("s-1")
    await expect(store.cursor("s-1")).resolves.toEqual({ seq: 0, at: 0 })
    const first = turnStarted(5)
    const last = turnStarted(9)
    await appendFile(
      timelineFile,
      [first, last, { ...last, seq: 10 }].map((envelope) => JSON.stringify(envelope)).join("\n"),
    )
    const cursor = await store.cursor("s-1")
    expect(store.list()[0]?.timelineCursor).toBe(0)
    expect(cursor).toEqual({ seq: 9, at: Date.parse(last.at) })

    const log = new SessionEventLog("s-1", () => Date.parse(first.at), cursor)
    const next = log.append({ type: "turn-started", turnId: "resumed" })
    for (let index = 0; index < maxEnvelopesPerRead; index += 1) {
      log.append({ type: "mode", permissionMode: "plan" })
    }

    expect(next).toMatchObject({ seq: 10, at: last.at })
    expect(log.since(0)).toHaveLength(maxEnvelopesPerRead)
    expect(log.since(9)[0]).toEqual(next)
    expect(log.since(10)[0]?.seq).toBe(11)
    expect(log.since(10).at(-1)?.seq).toBe(510)
  })

  it("读回早期信封时补子代理归属，不改变原始记录、序号或时间", async () => {
    const store = await storeWithSession()
    const file = store.paths("s-1").timelineFile
    const envelopes = [
      {
        ...turnStarted(1),
        event: { type: "message", messageId: "m-1", model: "Sonnet", blocks: [] },
      },
      {
        ...turnStarted(2),
        event: {
          type: "message",
          messageId: "m-2",
          model: "Sonnet",
          blocks: [],
          parentToolUseId: "t-agent",
        },
      },
      {
        ...turnStarted(3),
        event: { type: "tool-result", toolUseId: "t-1", content: "ok", isError: false },
      },
      {
        ...turnStarted(4),
        event: { type: "permission", requestId: "p-1", toolName: "Bash", input: {} },
      },
      {
        ...turnStarted(5),
        event: {
          type: "permission",
          requestId: "p-2",
          toolName: "Bash",
          input: {},
          subagent: { parentToolUseId: null, agentId: "agent-1" },
        },
      },
    ]
    const disk = envelopes.map((envelope) => JSON.stringify(envelope)).join("\n") + "\n"
    await appendFile(file, disk)

    const { envelopes: history } = await store.readTimeline("s-1")
    expect(history.map(({ seq, at }) => [seq, at])).toEqual(
      envelopes.map(({ seq, at }) => [seq, at]),
    )
    expect(history.map(({ event }) => ("subagent" in event ? event.subagent : undefined))).toEqual([
      null,
      { parentToolUseId: "t-agent", agentId: null },
      null,
      null,
      { parentToolUseId: null, agentId: "agent-1" },
    ])
    expect(await readFile(file, "utf8")).toBe(disk)
  })

  it("只把当前会话可回放的信封交给调用方，跳过其他会话和格式损坏的行", async () => {
    const store = await storeWithSession()
    const file = store.paths("s-1").timelineFile
    const lines = [
      turnStarted(1),
      { ...turnStarted(2), sessionId: "s-2" },
      { ...turnStarted(3), at: "not-a-date" },
      turnStarted(5),
      { ...turnStarted(6), event: { type: "unknown-event" } },
    ]
    await appendFile(file, lines.map((envelope) => JSON.stringify(envelope)).join("\n") + "\n")

    const page = await store.readTimeline("s-1")
    expect(page.envelopes.map(({ seq }) => seq)).toEqual([1, 5])
    expect(page.lastSeq).toBe(6)
    expect(await store.cursor("s-1")).toEqual({ seq: 6, at: Date.parse(turnStarted(6).at) })
    expect(page.skippedLines).toBe(3)
  })

  it("跳过合法 JSON 中不可回放的已知事件，仍用磁盘的最高序号继续", async () => {
    const store = await storeWithSession()
    const events = [
      { type: "turn-started", turnId: "old" },
      { type: "message", messageId: "missing-blocks", model: "Sonnet" },
      { type: "message", messageId: "non-block", model: "Sonnet", blocks: [null] },
      {
        type: "message",
        messageId: "ok",
        model: "Sonnet",
        subagent: "broken-owner",
        blocks: [{ type: "text", text: "仍然可回放" }],
      },
      { type: "permission", requestId: "broken", toolName: "Read", input: null },
      { type: "error", code: "SDK_ERROR", message: 42 },
      { type: "workflow", workflow: null },
      { type: "workflow", workflow: { toolCallId: "w1", agents: [null] } },
      { type: "workflow", workflow: { toolCallId: "w1", name: "旧快照" } },
      { type: "turn-ended", turnId: "old", status: "completed", errorCode: null },
      { type: "question", requestId: "missing-questions" },
    ]
    const lines = events.map((event, index) => ({ ...turnStarted(index + 1), event }))
    await appendFile(
      store.paths("s-1").timelineFile,
      lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
    )

    const page = await store.readTimeline("s-1", { afterSeq: 1 })
    expect(page.envelopes.map(({ seq }) => seq)).toEqual([4, 9, 10])
    expect(page.envelopes[0]?.event).toMatchObject({ subagent: null })
    expect(page.skippedLines).toBe(7)
    expect(page.lastSeq).toBe(11)
    expect((await store.cursor("s-1")).seq).toBe(11)
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
