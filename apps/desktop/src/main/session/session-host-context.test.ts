// 负责验证会话宿主查询上下文占用的时机：第一次 init 之后、每个 result 之后、上下文压缩之后、
// 换模型之后、换号之后各查一次，用 summary 模式；同一时间只查一次，失败不提示，不定时轮询，会话停止后不再查。
// 适配器是真实的 ClaudeAgentAdapter，SDK query 是回放录制消息的假实现。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SDKCompactBoundaryMessage, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, describe, expect, it, vi } from "vitest"
import { waitUntil } from "./session-host-fixtures"
import {
  loadContextReply,
  loadSdkFixture,
  replay,
  startReplay,
  type ReplayHarness,
} from "./session-replay-fixtures"
import type { SessionHostEvent } from "./session-types"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost context usage", () => {
  it("asks in summary mode after the first init and after the result, and reports each answer", async () => {
    const harness = await startReplay(await workspaceDir())
    harness.query.contextReply = async () => loadContextReply()

    await harness.host.send(harness.sessionId, { text: "hello" })
    replay(harness.query, loadSdkFixture("context-flags-2.1.310"))
    await waitUntil(() => contextEvents(harness).length === 2)

    expect(harness.query.contextRequests).toEqual([{ detail: "summary" }, { detail: "summary" }])
    const saved = harness.envelopes.filter((envelope) => envelope.event.type === "context")
    expect(saved.map((envelope) => typeof envelope.seq)).toEqual(["number", "number"])
    expect(contextEvents(harness)[1]).toEqual({
      type: "context",
      usedTokens: 35_002,
      maxTokens: 200_000,
      autoCompactTokens: 167_000,
    })
    await harness.host.dispose()
  })

  it("asks only once at a time and folds requests made meanwhile into one follow-up", async () => {
    const harness = await startReplay(await workspaceDir())
    const replies = heldReplies(harness)

    await harness.host.send(harness.sessionId, { text: "hello" })
    replay(harness.query, loadSdkFixture("context-flags-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))
    harness.runtime.switchAccount("acc-1", "acc-2")
    await settle()

    expect(harness.query.contextRequests).toHaveLength(1)
    replies.release(0, { totalTokens: 10 })
    await waitUntil(() => harness.query.contextRequests.length === 2)
    replies.release(1, { totalTokens: 20 })
    await waitUntil(() => contextEvents(harness).length === 2)
    await settle()

    expect(harness.query.contextRequests).toHaveLength(2)
    expect(contextEvents(harness).map(usedTokens)).toEqual([10, 20])
    await harness.host.dispose()
  })

  it("says nothing when a query fails and still answers the next request", async () => {
    const harness = await startReplay(await workspaceDir())
    const replies = heldReplies(harness)

    await harness.host.send(harness.sessionId, { text: "hello" })
    const before = harness.events.length
    replay(harness.query, loadSdkFixture("context-flags-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))
    replies.fail(0, new Error("Query closed before response received"))
    await waitUntil(() => harness.query.contextRequests.length === 2)
    replies.release(1, { totalTokens: 7 })
    await waitUntil(() => contextEvents(harness).length === 1)

    const types = harness.events.slice(before).map((event) => event.type)
    expect(types).not.toContain("error")
    expect(types).not.toContain("notice")
    expect(contextEvents(harness).map(usedTokens)).toEqual([7])
    await harness.host.dispose()
  })

  it("asks again after the context is compacted, without asking on later inits", async () => {
    const harness = await answeredFirstTurn()

    replay(harness.query, [compactBoundary()])
    await waitUntil(() => harness.query.contextRequests.length === 3)
    replay(harness.query, loadSdkFixture("context-flags-2.1.310").slice(0, 1))
    await settle()

    expect(harness.query.contextRequests).toHaveLength(3)
    await harness.host.dispose()
  })

  it("asks again once the model change is accepted", async () => {
    const harness = await answeredFirstTurn()

    await harness.host.setModel(harness.sessionId, "claude-opus-4")
    await waitUntil(() => contextEvents(harness).length === 3)

    expect(harness.query.modelChanges).toEqual(["claude-opus-4"])
    expect(harness.query.contextRequests).toHaveLength(3)
    await harness.host.dispose()
  })

  it("asks again after the account is switched, but not for the first account pick", async () => {
    const harness = await answeredFirstTurn()

    harness.runtime.switchAccount(null, "acc-1", "initial")
    await settle()
    expect(harness.query.contextRequests).toHaveLength(2)

    harness.runtime.switchAccount("acc-1", "acc-2", "quota")
    await waitUntil(() => contextEvents(harness).length === 3)

    expect(harness.query.contextRequests).toHaveLength(3)
    await harness.host.dispose()
  })

  it("drops an answer that arrives after the session stopped and asks nothing more", async () => {
    const harness = await startReplay(await workspaceDir())
    const replies = heldReplies(harness)
    await harness.host.send(harness.sessionId, { text: "hello" })
    replay(harness.query, loadSdkFixture("context-flags-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    await harness.host.stop(harness.sessionId)
    replies.release(0, { totalTokens: 10 })
    await settle()

    expect(harness.query.contextRequests).toHaveLength(1)
    expect(contextEvents(harness)).toEqual([])
    await harness.host.dispose()
  })

  it("asks nothing for model or account changes before the first init", async () => {
    const harness = await startReplay(await workspaceDir())
    harness.query.contextReply = async () => loadContextReply()

    harness.runtime.switchAccount("acc-1", "acc-2", "switch")
    await harness.host.setModel(harness.sessionId, "claude-opus-4")
    await settle()
    expect(harness.query.contextRequests).toEqual([])

    await harness.host.send(harness.sessionId, { text: "hello" })
    replay(harness.query, loadSdkFixture("context-flags-2.1.310").slice(0, 1))
    await waitUntil(() => contextEvents(harness).length === 1)

    expect(harness.query.contextRequests).toHaveLength(1)
    await harness.host.dispose()
  })

  it("does not poll while the session sits idle", async () => {
    const harness = await answeredFirstTurn()

    vi.useFakeTimers()
    try {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1_000)
    } finally {
      vi.useRealTimers()
    }

    expect(harness.query.contextRequests).toHaveLength(2)
    await harness.host.dispose()
  })
})

/** 第一轮已经跑完、两次查询都已回答的会话。 */
async function answeredFirstTurn(): Promise<ReplayHarness> {
  const harness = await startReplay(await workspaceDir())
  harness.query.contextReply = async () => loadContextReply()
  await harness.host.send(harness.sessionId, { text: "hello" })
  replay(harness.query, loadSdkFixture("context-flags-2.1.310"))
  await waitUntil(() => contextEvents(harness).length === 2)
  return harness
}

function compactBoundary(): SDKMessage {
  const message: SDKCompactBoundaryMessage = {
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "auto", pre_tokens: 160_000, post_tokens: 12_000 },
    uuid: "00000000-0000-4000-8000-00000000c0de",
    session_id: "4cddde5a-aa15-4031-b7d8-b8080ee2b325",
  }
  return message
}

type HeldReplies = {
  release: (index: number, reply: unknown) => void
  fail: (index: number, error: Error) => void
}

/** 让每次查询都挂起，由测试按顺序给出回复或失败。 */
function heldReplies(harness: ReplayHarness): HeldReplies {
  const pending: { resolve: (reply: unknown) => void; reject: (error: Error) => void }[] = []
  harness.query.contextReply = () =>
    new Promise((resolve, reject) => pending.push({ resolve, reject }))
  const at = (index: number) => {
    const request = pending[index]
    if (request === undefined) throw new Error(`context request ${index} was not made`)
    return request
  }
  return {
    release: (index, reply) => at(index).resolve(reply),
    fail: (index, error) => at(index).reject(error),
  }
}

/** 等几轮宏任务，让本该发生、但不该发生的查询有机会出现。 */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await new Promise((done) => setTimeout(done, 0))
}

function usedTokens(event: SessionHostEvent): number | null {
  return event.type === "context" ? event.usedTokens : null
}

function contextEvents(harness: ReplayHarness): SessionHostEvent[] {
  return harness.events.filter((event) => event.type === "context")
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-context-"))
  temporaryDirs.push(dir)
  return dir
}
