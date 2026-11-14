// 负责验证会话宿主发出的回复：主线程的思考消息带上主进程算好的思考耗时，
// 没有正常结束的一轮里还没落成消息的正文，在这一轮结束前补成一条消息。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { SessionEvent } from "./session-events"
import { createHarness, type SessionHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []
const t0 = Date.UTC(2026, 10, 14, 1, 0, 0)

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost reply", () => {
  it("writes how long the main thread thought into its thinking message", async () => {
    const { harness, sessionId, at } = await sentTurn()

    at(1_000)
    emit(harness, { type: "delta", text: "先想", thinking: true, blockIndex: 0 })
    at(3_000)
    emit(harness, { type: "delta", text: "一想", thinking: true, blockIndex: 0 })
    at(5_200)
    emit(harness, message("m1", [{ type: "thinking", text: "先想一想" }]))
    at(6_000)
    emit(harness, { type: "delta", text: "答", thinking: false, blockIndex: 1 })
    emit(harness, message("m1", [{ type: "text", text: "答" }]))

    expect(messages(harness)).toEqual([
      { blocks: [{ type: "thinking", text: "先想一想" }], thinkingMs: 4_200 },
      { blocks: [{ type: "text", text: "答" }] },
    ])
    await harness.host.stop(sessionId)
    await harness.host.dispose()
  })

  it("times each thinking block from its own first delta and leaves subagent thinking untimed", async () => {
    const { harness, sessionId, at } = await sentTurn()

    at(1_000)
    emit(harness, { type: "delta", text: "一", thinking: true, blockIndex: 0 })
    at(2_000)
    emit(harness, message("m1", [{ type: "thinking", text: "一" }]))
    emit(harness, message("m2", [{ type: "thinking", text: "子代理在想" }], "task-1"))
    at(10_000)
    emit(harness, { type: "delta", text: "二", thinking: true, blockIndex: 0 })
    at(10_500)
    emit(harness, message("m3", [{ type: "thinking", text: "二" }]))
    emit(harness, message("m4", [{ type: "thinking", text: "没有增量" }]))

    expect(messages(harness).map((event) => event.thinkingMs)).toEqual([
      1_000,
      undefined,
      500,
      undefined,
    ])
    await harness.host.stop(sessionId)
    await harness.host.dispose()
  })

  it("keeps a reply cut off by a stop as a message before the turn ends", async () => {
    const { harness, sessionId } = await sentTurn()
    emit(harness, { type: "delta", text: "先看", thinking: false, blockIndex: 0 })
    emit(harness, { type: "delta", text: "一下", thinking: false, blockIndex: 0 })

    const cancelling = harness.host.cancel(sessionId)
    emit(harness, result())
    await cancelling

    const tail = harness.events.slice(-2)
    expect(tail.map((event) => event.type)).toEqual(["message", "turn-ended"])
    expect(tail[0]).toMatchObject({
      type: "message",
      parentToolUseId: null,
      blocks: [{ type: "text", text: "先看一下" }],
    })
    await harness.host.dispose()
  })

  it("adds nothing to a turn whose text all arrived as messages", async () => {
    const { harness, sessionId } = await sentTurn()
    emit(harness, { type: "delta", text: "答", thinking: false, blockIndex: 0 })
    emit(harness, message("m1", [{ type: "text", text: "答" }]))
    emit(harness, result())

    const cancelling = harness.host.cancel(sessionId)
    await cancelling
    await harness.host.send(sessionId, { text: "再来" })
    emit(harness, { type: "delta", text: "半句", thinking: false, blockIndex: 0 })
    emit(harness, message("m2", [{ type: "text", text: "半句话" }]))
    emit(harness, result())

    expect(messages(harness)).toEqual([
      { blocks: [{ type: "text", text: "答" }] },
      { blocks: [{ type: "text", text: "半句话" }] },
    ])
    await harness.host.dispose()
  })
})

type Message = Extract<SessionEvent, { type: "message" }>

/** 已启动会话并发出一条消息；at 把主进程时钟拨到这一轮开始后若干毫秒。 */
async function sentTurn(): Promise<{
  harness: SessionHarness
  sessionId: string
  at: (offsetMs: number) => void
}> {
  let clock = t0
  const harness = createHarness({ workspace: await workspaceDir(), now: () => clock })
  const { sessionId } = await harness.host.start({
    workspace: harness.workspace,
    permissionMode: "default",
  })
  await harness.host.send(sessionId, { text: "想一想再答" })
  return { harness, sessionId, at: (offsetMs) => (clock = t0 + offsetMs) }
}

function emit(harness: SessionHarness, event: SessionEvent): void {
  harness.adapters.last.emit(event)
}

function message(
  messageId: string,
  blocks: Message["blocks"],
  parentToolUseId: string | null = null,
): Message {
  return { type: "message", messageId, model: "claude-sonnet", parentToolUseId, blocks }
}

function result(): SessionEvent {
  return {
    type: "result",
    subtype: "success",
    isError: false,
    durationMs: 10,
    numTurns: 1,
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
  }
}

/** 宿主发出的消息，只留内容块和思考耗时。 */
function messages(harness: SessionHarness): Array<Pick<Message, "blocks" | "thinkingMs">> {
  return harness.events.flatMap((event) =>
    event.type === "message"
      ? [
          {
            blocks: event.blocks,
            ...(event.thinkingMs === undefined ? {} : { thinkingMs: event.thinkingMs }),
          },
        ]
      : [],
  )
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-reply-"))
  temporaryDirs.push(dir)
  return dir
}
