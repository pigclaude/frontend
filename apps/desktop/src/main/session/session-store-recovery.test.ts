// 验证打开会话存储时的启动收敛：运行中的会话按有没有进行中的回合改为中断或停放，
// 中断的回合补「应用已重启」提示并闭合，没回答的提问记为已失效，其他状态的会话不动。

import { appendFile, chmod, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { SessionEnvelope } from "./session-envelope"
import type { SessionStoreStatus } from "./session-index"
import { SessionStore } from "./session-store"
import {
  envelopeOf,
  newSessionIndex,
  removeTemporaryDirs,
  temporaryDir,
} from "./session-store-fixtures"
import { appRestartedErrorCode, appRestartedNotice } from "./session-store-recovery"

const now = Date.parse("2026-11-14T12:00:00.000Z")

afterEach(removeTemporaryDirs)

const openTurn: SessionEnvelope[] = [
  envelopeOf("s-1", 1, { type: "turn-started", turnId: "turn-1" }),
  envelopeOf("s-1", 2, { type: "permission", requestId: "p-1", toolName: "Bash", input: {} }),
  envelopeOf("s-1", 3, {
    type: "question",
    requestId: "q-1",
    questions: [{ question: "继续吗？", options: [{ label: "是" }], multiSelect: false }],
  }),
]

const endedTurn: SessionEnvelope[] = [
  envelopeOf("s-1", 1, { type: "turn-started", turnId: "turn-1" }),
  envelopeOf("s-1", 2, {
    type: "turn-ended",
    turnId: "turn-1",
    status: "completed",
    errorCode: null,
  }),
]

async function seed(
  status: SessionStoreStatus,
  timeline: readonly SessionEnvelope[],
): Promise<string> {
  const root = join(await temporaryDir(), "session-store")
  const store = await SessionStore.open({ root })
  await store.create(newSessionIndex("s-1", { status }))
  for (const envelope of timeline) await store.appendTimeline("s-1", envelope)
  return root
}

describe("SessionStore 启动收敛", () => {
  it("运行中且有没结束的回合：改为中断，补提示、失效提问并闭合这一轮", async () => {
    const root = await seed("running", openTurn)

    const store = await SessionStore.open({ root, now: () => now })

    const page = await store.readTimeline("s-1")
    const at = new Date(now).toISOString()
    expect(page.envelopes.slice(3)).toEqual([
      {
        version: 1,
        sessionId: "s-1",
        seq: 4,
        at,
        event: { type: "question-resolved", requestId: "q-1", answers: [] },
      },
      {
        version: 1,
        sessionId: "s-1",
        seq: 5,
        at,
        event: { type: "notice", message: appRestartedNotice },
      },
      {
        version: 1,
        sessionId: "s-1",
        seq: 6,
        at,
        event: {
          type: "turn-ended",
          turnId: "turn-1",
          status: "interrupted",
          errorCode: appRestartedErrorCode,
        },
      },
    ])
    const expected = {
      status: "interrupted",
      lastTurn: { status: "interrupted", errorCode: appRestartedErrorCode },
      timelineCursor: 6,
      updatedAt: at,
    }
    expect(store.list()[0]).toMatchObject(expected)
    expect((await SessionStore.open({ root, now: () => now })).list()[0]).toMatchObject(expected)
  })

  it("已经回答过的提问不再补写失效", async () => {
    const answered = [
      ...openTurn,
      envelopeOf("s-1", 4, { type: "question-resolved", requestId: "q-1", answers: ["是"] }),
    ]
    const root = await seed("running", answered)

    const store = await SessionStore.open({ root, now: () => now })

    const added = (await store.readTimeline("s-1", { afterSeq: 4 })).envelopes
    expect(added.map((envelope) => envelope.event.type)).toEqual(["notice", "turn-ended"])
  })

  it("运行中但回合都已结束：改为停放，时间线不动", async () => {
    const root = await seed("running", endedTurn)

    const store = await SessionStore.open({ root, now: () => now })

    expect(store.list()[0]).toMatchObject({ status: "parked", lastTurn: null, timelineCursor: 2 })
    expect((await store.readTimeline("s-1")).envelopes).toHaveLength(2)
  })

  it("运行中但还没有时间线：改为停放", async () => {
    const root = await seed("running", [])

    const store = await SessionStore.open({ root, now: () => now })

    expect(store.list()[0]).toMatchObject({ status: "parked", timelineCursor: 0 })
  })

  it.each<SessionStoreStatus>(["parked", "interrupted", "failed"])(
    "状态为 %s 的会话不收敛，索引和时间线都不改",
    async (status) => {
      const root = await seed(status, openTurn)
      const indexFile = join(root, "s-1", "index.json")
      const timelineFile = join(root, "s-1", "timeline.jsonl")
      const before = [await readFile(indexFile, "utf8"), await readFile(timelineFile, "utf8")]

      await SessionStore.open({ root, now: () => now })

      expect([await readFile(indexFile, "utf8"), await readFile(timelineFile, "utf8")]).toEqual(
        before,
      )
    },
  )

  it("收敛失败的会话不进内存索引，索引不改，只记日志", async () => {
    const root = await seed("running", [])
    const indexFile = join(root, "s-1", "index.json")
    const before = await readFile(indexFile, "utf8")
    await mkdir(join(root, "s-1", "timeline.jsonl"))
    const logs: string[] = []

    const store = await SessionStore.open({ root, now: () => now, log: (m) => logs.push(m) })

    expect(store.list()).toEqual([])
    expect(await readFile(indexFile, "utf8")).toBe(before)
    expect(logs).toEqual([expect.stringContaining("s-1")])
  })

  it.skipIf(process.platform === "win32")(
    "上次收敛补写了时间线但索引没写成，重开时按中断处理且不重复补写",
    async () => {
      const root = await seed("running", openTurn)
      const directory = join(root, "s-1")
      await chmod(directory, 0o500)
      try {
        const failed = await SessionStore.open({ root, now: () => now, log: () => undefined })
        expect(failed.list()).toEqual([])
      } finally {
        await chmod(directory, 0o700)
      }

      const store = await SessionStore.open({ root, now: () => now + 60_000 })

      expect(store.list()[0]).toMatchObject({
        status: "interrupted",
        lastTurn: { status: "interrupted", errorCode: appRestartedErrorCode },
        timelineCursor: 6,
      })
      expect((await store.readTimeline("s-1")).envelopes.map((e) => e.seq)).toEqual([
        1, 2, 3, 4, 5, 6,
      ])
    },
  )

  it("补写的信封时间不早于时间线最后一条", async () => {
    const root = await seed("running", openTurn)
    const lastAt = openTurn.at(-1)?.at ?? ""

    const store = await SessionStore.open({ root, now: () => Date.parse(lastAt) - 60_000 })

    const added = (await store.readTimeline("s-1", { afterSeq: 3 })).envelopes
    expect(added.map((envelope) => envelope.at)).toEqual([lastAt, lastAt, lastAt])
  })

  it("末行不完整时先截掉半行，再接着最后一个完整的序号补写", async () => {
    const root = await seed("running", openTurn)
    await appendFile(join(root, "s-1", "timeline.jsonl"), '{"version":1,"seq":4,"ev')

    const store = await SessionStore.open({ root, now: () => now })

    const page = await store.readTimeline("s-1")
    expect(page.envelopes.map((envelope) => envelope.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(page.skippedLines).toBe(0)
  })
})
