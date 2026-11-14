// 回放随包 SDK 的会话消息，验证发送前应用思考深度和快速模式，以及快速模式没有生效时的提示。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SDKMessage, SDKSystemMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, describe, expect, it } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { collectPrompt, FakeQuery } from "./claude-agent-adapter-fixtures"
import { createHarness, waitUntil, type SessionHarness } from "./session-host-fixtures"
import { loadSdkFixture, replay } from "./session-replay-fixtures"
import type { SessionStartInput } from "./session-types"

type FlagHarness = SessionHarness & {
  query: FlagQuery
  prompts: SDKUserMessage[]
  sessionId: string
  collected: Promise<void>
}

const sessions: FlagHarness[] = []

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.host.dispose()
    await session.collected
    await rm(session.workspace, { recursive: true, force: true })
  }
})

describe("SessionHost turn settings", () => {
  it("waits for changed settings before writing the prompt and skips the same settings", async () => {
    const session = await startSession({ effort: "low" })
    const releaseSettings = holdSettings(session.query)
    const sending = session.host.send(session.sessionId, {
      text: "first",
      effort: "max",
      fast: true,
    })
    const sent = sending.then(() => "sent")
    await expect(
      Promise.race([sent, waitUntil(() => session.query.flags.length > 0).then(() => "settings")]),
    ).resolves.toBe("settings")
    expect(session.prompts).toEqual([])
    expect(session.query.flags).toEqual([{ effortLevel: "max", fastMode: true }])
    expect(session.events.some((event) => event.type === "turn-started")).toBe(false)

    releaseSettings()
    await sending
    await waitUntil(() => session.prompts.length === 1)
    expect(session.prompts[0]?.message.content).toBe("first")
    await finishTurn(session)
    await session.host.send(session.sessionId, { text: "second", effort: "max", fast: true })
    await waitUntil(() => session.prompts.length === 2)

    expect(session.prompts[1]?.message.content).toBe("second")
    expect(session.query.flags).toHaveLength(1)
  })

  it("uses the startup flags as its baseline and explicitly resets to model default and standard speed", async () => {
    const session = await startSession({ effort: "high", fast: true })
    await session.host.send(session.sessionId, { text: "initial" })
    expect(session.query.flags).toEqual([])
    await finishTurn(session, turnMessages({ fast_mode_state: "on" }))

    await session.host.send(session.sessionId, { text: "reset", effort: null, fast: false })
    expect(session.query.flags).toEqual([{ effortLevel: null, fastMode: false }])
    await finishTurn(session)
    expect(notices(session)).toEqual([])
  })

  it("keeps a rejected settings change off the prompt stream and retries it on the next send", async () => {
    const session = await startSession()
    session.query.reply = () => Promise.reject(new Error("settings rejected"))
    const input = { text: "retry me", effort: "high" } as const

    await expect(session.host.send(session.sessionId, input)).rejects.toMatchObject({
      code: "SDK_ERROR",
    })
    expect(session.prompts).toEqual([])
    expect(session.events.some((event) => event.type === "turn-started")).toBe(false)

    session.query.reply = () => Promise.resolve()
    await session.host.send(session.sessionId, input)
    await waitUntil(() => session.prompts.length === 1)
    expect(session.prompts[0]?.message.content).toBe("retry me")
    expect(session.query.flags).toEqual([{ effortLevel: "high" }, { effortLevel: "high" }])
  })

  it("lets a replacement send wait for a cancelled settings change without sending the cancelled prompt", async () => {
    const session = await startSession()
    const releaseSettings = holdSettings(session.query)
    const abandoned = session.host.send(session.sessionId, { text: "abandoned", fast: true })
    await waitUntil(() => session.query.flags.length === 1)

    await session.host.cancel(session.sessionId)
    const resumed = session.host.send(session.sessionId, { text: "resumed", fast: false })
    expect(session.prompts).toEqual([])
    releaseSettings()

    await Promise.all([abandoned, resumed])
    await waitUntil(() => session.prompts.length === 1)
    expect(session.prompts.map((prompt) => prompt.message.content)).toEqual(["resumed"])
    expect(session.query.flags).toEqual([{ fastMode: true }, { fastMode: false }])
  })

  it("warns from the first init of each fast turn, including later turns on the same query", async () => {
    const session = await startSession({ fast: true })
    // 启动探针的 init 在实际发送之前，不能生成这条消息对应的提示。
    session.query.emit(initWith({ fast_mode_state: "off" }))
    await waitUntil(() => session.events.some((event) => event.type === "started"))
    expect(notices(session)).toEqual([])

    await session.host.send(session.sessionId, { text: "first", fast: true })
    await finishTurn(
      session,
      turnMessages(
        { fast_mode_state: "off", fast_mode_disabled_reason: "extra_usage_disabled" },
        initWith({ fast_mode_state: "off", fast_mode_disabled_reason: "free" }),
      ),
    )
    await session.host.send(session.sessionId, { text: "second", fast: true })
    await finishTurn(session, turnMessages({ fast_mode_state: "cooldown" }))
    await session.host.send(session.sessionId, { text: "third", fast: true })
    await finishTurn(session, turnMessages({ fast_mode_state: "off" }))

    expect(session.events.filter((event) => event.type === "started")).toHaveLength(1)
    expect(notices(session)).toMatchObject([
      { key: "fast.unavailable.extra_usage_disabled", level: "warning", params: {} },
      { key: "fast.unavailable.cooldown", level: "warning", params: {} },
      { key: "fast.unavailable", level: "warning", params: {} },
    ])
    const boundaries = session.events.flatMap((event) =>
      event.type === "turn-started" || event.type === "turn-ended" || event.type === "notice"
        ? [event.type]
        : [],
    )
    expect(boundaries).toEqual([
      "turn-started",
      "notice",
      "turn-ended",
      "turn-started",
      "notice",
      "turn-ended",
      "turn-started",
      "notice",
      "turn-ended",
    ])
  })

  it("skips notices when the first init reports fast mode on, omits the state, or was not requested", async () => {
    const session = await startSession()
    await session.host.send(session.sessionId, { text: "unrequested" })
    await finishTurn(session)
    await session.host.send(session.sessionId, { text: "working", fast: true })
    await finishTurn(session, turnMessages({ fast_mode_state: "on" }))
    await session.host.send(session.sessionId, { text: "unreported" })
    await finishTurn(session, turnMessages({}, initWith({ fast_mode_state: "off" })))

    expect(notices(session)).toEqual([])
  })
})

class FlagQuery extends FakeQuery {
  readonly flags: unknown[] = []
  reply: () => Promise<void> = () => Promise.resolve()

  async applyFlagSettings(settings?: unknown): Promise<void> {
    this.flags.push(settings)
    await this.reply()
  }
}

type InitFlags = Pick<SDKSystemMessage, "fast_mode_state" | "fast_mode_disabled_reason">

function initWith(flags: InitFlags): SDKSystemMessage {
  const init = loadSdkFixture("context-flags-2.1.310")[0]
  if (init?.type !== "system" || init.subtype !== "init") throw new Error("录制缺少 init")
  const message = { ...init }
  delete message.fast_mode_state
  delete message.fast_mode_disabled_reason
  return { ...message, ...flags }
}

function turnMessages(flags: InitFlags, ...extraInits: SDKSystemMessage[]): SDKMessage[] {
  const [, ...messages] = loadSdkFixture("context-flags-2.1.310")
  return [initWith(flags), ...extraInits, ...messages]
}

function notices(session: FlagHarness) {
  return session.events.filter((event) => event.type === "notice")
}

function holdSettings(query: FlagQuery): () => void {
  let release = () => {}
  const response = new Promise<void>((resolve) => {
    release = resolve
  })
  query.reply = () => response
  return release
}

async function startSession(
  input: Pick<SessionStartInput, "effort" | "fast"> = {},
): Promise<FlagHarness> {
  const workspace = await mkdtemp(join(tmpdir(), "pigclaude-turn-flags-"))
  const query = new FlagQuery()
  const prompts: SDKUserMessage[] = []
  let collected = Promise.resolve()
  const harness = createHarness({
    workspace,
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ prompt }) => {
          collected = collectPrompt(prompt, prompts)
          return query
        },
      }),
  })
  const { sessionId } = await harness.host.start({ ...input, workspace, permissionMode: "default" })
  const session = { ...harness, query, prompts, sessionId, collected }
  sessions.push(session)
  return session
}

async function finishTurn(
  session: FlagHarness,
  messages: readonly SDKMessage[] = loadSdkFixture("context-flags-2.1.310"),
): Promise<void> {
  replay(session.query, messages)
  await waitUntil(() => session.host.status().turnId === null)
}
