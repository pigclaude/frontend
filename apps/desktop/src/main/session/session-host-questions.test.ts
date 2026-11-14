// 负责验证 AskUserQuestion 经会话宿主的处理：canUseTool 按工具名分给提问代理或权限代理，
// 回答的格式，取消、空答案、停止和会员失效时的拒绝，10 分钟没回答时结束这一轮，
// 以及回放 2.1.310 在计划模式下录制的一次提问。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CanUseTool, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import {
  createHarness,
  currentSessionId,
  waitUntil,
  type SessionHarness,
} from "./session-host-fixtures"
import { loadSdkFixture, replay, startReplay, turnBoundaries } from "./session-replay-fixtures"
import type { SessionHostEvent, SessionPermissionMode } from "./session-types"

type QuestionEvent = Extract<SessionHostEvent, { type: "question" }>

const temporaryDirs: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const colorQuestion = {
  question: "Which color should the label use?",
  header: "Color",
  multiSelect: false,
  options: [
    { label: "Blue", description: "Matches the theme" },
    { label: "Green", description: "Stands out" },
  ],
}

const platformQuestion = {
  question: "Which platforms should it cover?",
  header: "Platforms",
  multiSelect: true,
  options: [{ label: "macOS" }, { label: "Windows" }, { label: "Linux" }],
}

describe("SessionHost questions", () => {
  it("asks AskUserQuestion on a question card and answers with the question mapped to the choice", async () => {
    const harness = await startedHarness()
    const input = { questions: [colorQuestion, platformQuestion] }

    const pending = canUseTool(harness)("AskUserQuestion", input, askOptions())
    const question = await waitForQuestion(harness)

    expect(question).toMatchObject({
      type: "question",
      questions: [
        {
          question: "Which color should the label use?",
          header: "Color",
          multiSelect: false,
          options: [
            { label: "Blue", description: "Matches the theme" },
            { label: "Green", description: "Stands out" },
          ],
        },
        {
          question: "Which platforms should it cover?",
          header: "Platforms",
          multiSelect: true,
          options: [{ label: "macOS" }, { label: "Windows" }, { label: "Linux" }],
        },
      ],
    })
    expect(harness.events.some((event) => event.type === "permission")).toBe(false)

    harness.host.answerQuestion(currentSessionId(harness.host), {
      requestId: question.requestId,
      answers: ["Blue", "macOS, Linux"],
    })

    await expect(pending).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        questions: [colorQuestion, platformQuestion],
        answers: {
          "Which color should the label use?": "Blue",
          "Which platforms should it cover?": "macOS, Linux",
        },
      },
    })
    await harness.host.dispose()
  })

  it("keeps ExitPlanMode, other tools and an AskUserQuestion without questions on the permission card", async () => {
    const harness = await startedHarness("plan")
    const canUse = canUseTool(harness)

    void canUse("ExitPlanMode", { plan: "Edit two files" }, askOptions())
    void canUse("Bash", { command: "ls" }, askOptions())
    void canUse("AskUserQuestion", { questions: [{ header: "No text" }] }, askOptions())
    await waitUntil(() => harness.events.filter((event) => event.type === "permission").length >= 3)

    expect(
      harness.events.flatMap((event) => (event.type === "permission" ? [event.toolName] : [])),
    ).toEqual(["ExitPlanMode", "Bash", "AskUserQuestion"])
    expect(harness.events.some((event) => event.type === "question")).toBe(false)
    expect(harness.host.status()).toMatchObject({ pendingPermissions: 3, pendingQuestions: 0 })
    await harness.host.dispose()
  })

  it("asks on the same question card in plan mode", async () => {
    const harness = await startedHarness("plan")

    const pending = canUseTool(harness)(
      "AskUserQuestion",
      { questions: [colorQuestion] },
      askOptions(),
    )
    const question = await waitForQuestion(harness)
    expect(harness.host.status()).toMatchObject({ pendingPermissions: 0, pendingQuestions: 1 })
    harness.host.answerQuestion(currentSessionId(harness.host), {
      requestId: question.requestId,
      answers: ["Green"],
    })

    await expect(pending).resolves.toMatchObject({
      behavior: "allow",
      updatedInput: { answers: { "Which color should the label use?": "Green" } },
    })
    expect(harness.events).toContainEqual({
      type: "question-resolved",
      requestId: question.requestId,
      answers: ["Green"],
    })
    await harness.host.dispose()
  })

  it("denies blank answers with a message for the model", async () => {
    const harness = await startedHarness()

    const pending = canUseTool(harness)(
      "AskUserQuestion",
      { questions: [colorQuestion, platformQuestion] },
      askOptions(),
    )
    const question = await waitForQuestion(harness)
    harness.host.answerQuestion(currentSessionId(harness.host), {
      requestId: question.requestId,
      answers: ["  ", ""],
    })

    await expect(pending).resolves.toEqual({
      behavior: "deny",
      message: "The user did not answer these questions.",
    })
    expect(harness.events).toContainEqual({
      type: "question-resolved",
      requestId: question.requestId,
      answers: [],
    })
    await harness.host.dispose()
  })

  it("refuses answers that do not match the questions and keeps the question open", async () => {
    const harness = await startedHarness()
    void canUseTool(harness)("AskUserQuestion", { questions: [colorQuestion] }, askOptions())
    const question = await waitForQuestion(harness)

    expect(() =>
      harness.host.answerQuestion(currentSessionId(harness.host), {
        requestId: question.requestId,
        answers: ["Blue", "Extra"],
      }),
    ).toThrow("INVALID_SESSION_INPUT")
    expect(harness.host.status().pendingQuestions).toBe(1)
    await harness.host.dispose()
  })

  it("ignores answers for another session or an unknown question", async () => {
    const harness = await startedHarness()
    void canUseTool(harness)("AskUserQuestion", { questions: [colorQuestion] }, askOptions())
    const question = await waitForQuestion(harness)

    harness.host.answerQuestion("other-session", {
      requestId: question.requestId,
      answers: ["Blue"],
    })
    harness.host.answerQuestion(currentSessionId(harness.host), {
      requestId: "missing",
      answers: ["Blue"],
    })

    expect(harness.host.status().pendingQuestions).toBe(1)
    await harness.host.dispose()
  })

  it("denies an open question when the user stops the turn and keeps the session", async () => {
    const harness = await startedHarness()
    const pending = canUseTool(harness)(
      "AskUserQuestion",
      { questions: [colorQuestion] },
      askOptions(),
    )
    const question = await waitForQuestion(harness)

    await harness.host.cancel(currentSessionId(harness.host))

    await expect(pending).resolves.toEqual({
      behavior: "deny",
      message: "The user did not answer these questions.",
    })
    expect(harness.events).toContainEqual({
      type: "question-resolved",
      requestId: question.requestId,
      answers: [],
    })
    expect(harness.adapters.last.interrupts).toBe(1)
    expect(harness.host.status()).toMatchObject({ active: true, pendingQuestions: 0 })
    await harness.host.dispose()
  })

  it("denies open questions before interrupting when the session stops", async () => {
    const harness = await startedHarness()
    const pending = canUseTool(harness)(
      "AskUserQuestion",
      { questions: [colorQuestion] },
      askOptions(),
    ).then((result) => {
      harness.trace.push("denied")
      return result
    })
    await waitForQuestion(harness)

    await harness.host.stop()

    await expect(pending).resolves.toMatchObject({ behavior: "deny" })
    expect(harness.trace).toEqual(["started", "denied", "interrupted", "stopped", "cleaned"])
    await harness.host.dispose()
  })

  it("denies open questions and permissions together when membership is lost", async () => {
    const harness = await startedHarness()
    const canUse = canUseTool(harness)
    const question = canUse("AskUserQuestion", { questions: [colorQuestion] }, askOptions())
    const permission = canUse("Bash", { command: "rm" }, askOptions())
    await waitForQuestion(harness)

    harness.membership.setState("expired")
    await waitUntil(() => !harness.host.status().active)

    await expect(question).resolves.toMatchObject({ behavior: "deny" })
    await expect(permission).resolves.toMatchObject({ behavior: "deny" })
    expect(() =>
      harness.host.answerQuestion(currentSessionId(harness.host), {
        requestId: "late",
        answers: ["Blue"],
      }),
    ).toThrow("MEMBERSHIP_REQUIRED")
    await harness.host.dispose()
  })

  it("denies after ten minutes, denies the other open requests and ends the turn with QUESTION_TIMEOUT", async () => {
    const harness = await startedHarness()
    await harness.host.send(currentSessionId(harness.host), { text: "Pick a color" })
    vi.useFakeTimers()
    const canUse = canUseTool(harness)

    const question = canUse("AskUserQuestion", { questions: [colorQuestion] }, askOptions())
    await vi.advanceTimersByTimeAsync(60_000)
    const permission = canUse("Bash", { command: "ls" }, askOptions())
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 - 60_000)

    await expect(question).resolves.toEqual({
      behavior: "deny",
      message: "The user did not answer these questions.",
    })
    await expect(permission).resolves.toMatchObject({ behavior: "deny" })
    expect(harness.events).toContainEqual({
      type: "error",
      code: "QUESTION_TIMEOUT",
      message: "提问超时",
    })
    expect(harness.adapters.last.interrupts).toBe(1)
    expect(harness.host.status()).toMatchObject({ pendingPermissions: 0, pendingQuestions: 0 })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        type: "turn-ended",
        status: "error",
        errorCode: "QUESTION_TIMEOUT",
      }),
    )
    vi.useRealTimers()
    await harness.host.dispose()
  })
})

describe("SessionHost question replay", () => {
  it("answers the question recorded in plan mode the way Claude Code accepted it", async () => {
    const messages = loadSdkFixture("ask-plan-2.1.310")
    const asking = messages.findIndex((message) => toolUseInput(message) !== null)
    const input = toolUseInput(messages[asking])
    if (input === null) throw new Error("the fixture has no AskUserQuestion call")
    const harness = await startReplay(await workspaceDir(), "plan")
    await harness.host.send(harness.sessionId, { text: "Ask me which color to use" })

    replay(harness.query, messages.slice(0, asking + 1))
    const pending = harness.canUseTool("AskUserQuestion", input, askOptions())
    const question = await waitForQuestion(harness)
    harness.host.answerQuestion(harness.sessionId, {
      requestId: question.requestId,
      answers: ["Blue"],
    })

    await expect(pending).resolves.toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which color should the label use?": "Blue" } },
    })
    replay(harness.query, messages.slice(asking + 1))
    await waitUntil(() => harness.events.some((event) => event.type === "turn-ended"))
    expect(turnBoundaries(harness.events)).toEqual([
      "turn-started",
      "result",
      "turn-ended:completed",
    ])
    expect(
      harness.events.flatMap((event) =>
        ["question", "question-resolved", "tool-result"].includes(event.type) ? [event.type] : [],
      ),
    ).toEqual(["question", "question-resolved", "tool-result"])
    await harness.host.dispose()
  })
})

function toolUseInput(message: SDKMessage | undefined): Record<string, unknown> | null {
  if (message?.type !== "assistant") return null
  for (const block of message.message.content) {
    if (block.type === "tool_use" && block.name === "AskUserQuestion") {
      return block.input as Record<string, unknown>
    }
  }
  return null
}

function canUseTool(harness: SessionHarness): CanUseTool {
  const canUse = harness.adapters.last.canUseTool
  if (canUse === null) throw new Error("canUseTool was not passed to the adapter")
  return canUse
}

async function startedHarness(
  permissionMode: SessionPermissionMode = "default",
): Promise<SessionHarness> {
  const harness = createHarness({ workspace: await workspaceDir() })
  await harness.host.start({ workspace: harness.workspace, permissionMode })
  return harness
}

async function waitForQuestion(harness: SessionHarness, expected = 1): Promise<QuestionEvent> {
  await waitUntil(
    () => harness.events.filter((event) => event.type === "question").length >= expected,
  )
  const event = harness.events
    .filter((candidate): candidate is QuestionEvent => candidate.type === "question")
    .at(-1)
  if (event === undefined) throw new Error("question event was not emitted")
  return event
}

function askOptions(): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID: "tool-1",
    requestId: "request-1",
  }
}

async function workspaceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pigclaude-session-questions-"))
  temporaryDirs.push(dir)
  return dir
}
