// 负责用录制的 SDK 消息回放验证回合开闭：后台子代理和工作流跑完才结束一轮、停止时连后台任务一起停、
// 每轮用量取会话累计用量的差值。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModelUsage, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, describe, expect, it } from "vitest"
import { waitUntil } from "./session-host-fixtures"
import { loadSdkFixture, replay, startReplay, turnBoundaries } from "./session-replay-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("SessionHost turns", () => {
  it("keeps the turn open past the first result until the background subagent's continuation ends", async () => {
    const harness = await startReplay(await workspaceDir())

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, loadSdkFixture("background-agent-2.1.310"))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    expect(turnBoundaries(harness.events)).toEqual([
      "turn-started",
      "result",
      "result",
      "turn-ended:completed",
    ])
    expect(harness.host.status().turnId).toBeNull()
    await harness.host.dispose()
  })

  it("refuses a new message while the background subagent is still running", async () => {
    const harness = await startReplay(await workspaceDir())
    const messages = loadSdkFixture("background-agent-2.1.310")
    const firstResult = messages.findIndex((message) => message.type === "result")

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, messages.slice(0, firstResult + 1))
    await waitUntil(() => harness.events.some((event) => event.type === "result"))

    await expect(harness.host.send(harness.sessionId, { text: "next" })).rejects.toMatchObject({
      code: "SESSION_ALREADY_ACTIVE",
    })
    expect(harness.host.status().turnId).not.toBeNull()
    expect(harness.host.pendingWork()).toEqual({ turns: 1, approvals: 0 })
    await harness.host.dispose()
  })

  it("records one usage row per turn that includes the subagent and the continuation", async () => {
    const harness = await startReplay(await workspaceDir())

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, loadSdkFixture("background-agent-2.1.310"))
    await waitUntil(() => harness.usage.records.length === 1)

    expect(harness.usage.records).toMatchObject([
      {
        sessionId: harness.sessionId,
        status: "success",
        errorCode: null,
        inputTokens: 1_948,
        outputTokens: 662,
        cacheReadTokens: 93_824,
        cacheCreationTokens: 0,
      },
    ])
    await harness.host.dispose()
  })

  it("records the next turn as the growth of the session total since the last turn", async () => {
    const harness = await startReplay(await workspaceDir())
    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, loadSdkFixture("background-agent-2.1.310"))
    await waitUntil(() => harness.usage.records.length === 1)

    await harness.host.send(harness.sessionId, { text: "and again" })
    harness.query.emit(
      resultWithTotal({
        inputTokens: 2_000,
        outputTokens: 700,
        cacheReadInputTokens: 100_000,
        cacheCreationInputTokens: 10,
      }),
    )
    await waitUntil(() => harness.usage.records.length === 2)

    expect(harness.usage.records[1]).toMatchObject({
      inputTokens: 52,
      outputTokens: 38,
      cacheReadTokens: 6_176,
      cacheCreationTokens: 10,
    })
    await harness.host.dispose()
  })

  it("falls back to pairing task starts with notifications when the CLI sends no task list", async () => {
    const harness = await startReplay(await workspaceDir())
    const withoutLevel = loadSdkFixture("background-agent-2.1.310").filter(
      (message) => !(message.type === "system" && message.subtype === "background_tasks_changed"),
    )

    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, withoutLevel)
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))

    expect(turnBoundaries(harness.events)).toEqual([
      "turn-started",
      "result",
      "result",
      "turn-ended:completed",
    ])
    await harness.host.dispose()
  })

  it.each([
    ["workflow-2.1.310", [14_621, 1_564, 142_976, 0]],
    ["workflow-2.1.304", [1_349, 2_752, 693_665, 107_444]],
  ] as const)("waits for the %s workflow and its continuation", async (fixture, tokens) => {
    const harness = await startReplay(await workspaceDir())

    await harness.host.send(harness.sessionId, { text: "run a workflow" })
    replay(harness.query, loadSdkFixture(fixture))
    await waitUntil(() => harness.usage.records.length === 1)

    expect(turnBoundaries(harness.events)).toEqual([
      "turn-started",
      "result",
      "result",
      "turn-ended:completed",
    ])
    const [record] = harness.usage.records
    expect([
      record?.inputTokens,
      record?.outputTokens,
      record?.cacheReadTokens,
      record?.cacheCreationTokens,
    ]).toEqual(tokens)
    await harness.host.dispose()
  })

  it("stops by interrupting, then stopping each running background task, then ending the turn as interrupted", async () => {
    const harness = await startReplay(await workspaceDir())
    const messages = loadSdkFixture("background-interrupt-2.1.310")
    const killed = messages.findIndex(
      (message) => message.type === "system" && message.subtype === "task_updated",
    )
    const controlsAtEnd: string[][] = []
    harness.host.subscribe(({ event }) => {
      if (event.type === "turn-ended") controlsAtEnd.push([...harness.query.controls])
    })
    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, messages.slice(0, killed))
    await waitUntil(() => harness.events.some((event) => event.type === "result"))
    harness.query.afterInterrupt = () => replay(harness.query, messages.slice(killed))

    await harness.host.cancel(harness.sessionId)

    expect(controlsAtEnd).toEqual([["interrupt", "stopTask:a6f0343a114194060"]])
    expect(turnBoundaries(harness.events)).toEqual([
      "turn-started",
      "result",
      "turn-ended:interrupted",
    ])
    expect(harness.events.find((event) => event.type === "turn-ended")).toMatchObject({
      errorCode: "SESSION_CANCELLED",
    })
    expect(harness.usage.records).toMatchObject([
      { status: "cancelled", errorCode: "SESSION_CANCELLED", inputTokens: 2_523 },
    ])
    expect(harness.host.status()).toMatchObject({ active: true, turnId: null })
    await harness.host.dispose()
  })

  it("waits for the result of an interrupted reply so it cannot end the next turn", async () => {
    const harness = await startReplay(await workspaceDir())
    const [init, , , , , reply, result] = loadSdkFixture("background-agent-2.1.310")
    if (init === undefined || reply === undefined || result?.type !== "result") {
      throw new Error("fixture changed")
    }
    await harness.host.send(harness.sessionId, { text: "long answer" })
    replay(harness.query, [init, reply])
    await waitUntil(() => harness.events.some((event) => event.type === "message"))
    harness.query.afterInterrupt = () => harness.query.emit(result)

    await harness.host.cancel(harness.sessionId)
    await harness.host.send(harness.sessionId, { text: "next" })

    expect(turnBoundaries(harness.events)).toEqual([
      "turn-started",
      "result",
      "turn-ended:interrupted",
      "turn-started",
    ])
    expect(harness.usage.records).toMatchObject([{ status: "cancelled", inputTokens: 608 }])
    expect(harness.host.status().turnId).not.toBeNull()
    await harness.host.dispose()
  })

  it("ends a turn stopped while its first message waits for the workbench baseline", async () => {
    const harness = await startReplay(await workspaceDir())
    let releaseBaseline: () => void = () => undefined
    const baseline = new Promise<void>((resolve) => {
      releaseBaseline = resolve
    })

    const sending = harness.host.send(harness.sessionId, { text: "edit files" }, () => baseline)
    await harness.host.cancel(harness.sessionId)
    releaseBaseline()
    await sending

    expect(turnBoundaries(harness.events)).toEqual(["turn-started", "turn-ended:interrupted"])
    expect(harness.host.status().turnId).toBeNull()
    expect(harness.usage.records).toEqual([])
    await harness.host.dispose()
  })

  it("ends the open turn as interrupted before the session ends when the session is stopped", async () => {
    const harness = await startReplay(await workspaceDir())
    const messages = loadSdkFixture("background-agent-2.1.310")
    const firstResult = messages.findIndex((message) => message.type === "result")
    await harness.host.send(harness.sessionId, { text: "start a background subagent" })
    replay(harness.query, messages.slice(0, firstResult + 1))
    await waitUntil(() => harness.events.some((event) => event.type === "result"))

    await harness.host.stop(harness.sessionId)

    expect(harness.query.controls).toEqual(["interrupt", "stopTask:a74b36fd6cc2efc90"])
    expect(
      harness.events.flatMap((event) =>
        event.type === "turn-ended" || event.type === "ended" ? [event.type] : [],
      ),
    ).toEqual(["turn-ended", "ended"])
    expect(harness.usage.records).toMatchObject([{ status: "cancelled", inputTokens: 608 }])
    await harness.host.dispose()
  })
})

function resultWithTotal(total: Record<string, number>): SDKMessage {
  const last = loadSdkFixture("background-agent-2.1.310")
    .filter((message) => message.type === "result")
    .at(-1)
  if (last?.type !== "result") throw new Error("fixture has no result")
  return { ...last, modelUsage: { "deepseek-v4.1-flash": { ...modelUsageOf(last), ...total } } }
}

function modelUsageOf(message: Extract<SDKMessage, { type: "result" }>): ModelUsage {
  const usage = Object.values(message.modelUsage)[0]
  if (usage === undefined) throw new Error("fixture result has no model usage")
  return usage
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-turns-"))
  temporaryDirs.push(dir)
  return dir
}
