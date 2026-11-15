// 通过真实会话宿主和假 SDK 验证定时会话的首轮、排队、停放与续接。

import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { CanUseTool, Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, expect, it, vi } from "vitest"
import type { ScheduledTaskInput } from "../../scheduled-tasks-contract"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { collectPrompt, FakeQuery } from "./claude-agent-adapter-fixtures"
import { SessionClaudeExitError } from "./session-claude-launch"
import { ManualClock } from "./session-clock-fixture"
import { retainedClaudeProject } from "./session-environment"
import type { AdapterEvent } from "./session-events"
import { createHarness, fixedNow, waitUntil } from "./session-host-fixtures"
import { loadSdkFixture } from "./session-replay-fixtures"
import { SessionStore } from "./session-store"
import { removeTemporaryDirs, temporaryDir } from "./session-store-fixtures"
import { threadReadServerName } from "./thread-read"

const minute = 60_000
const model = "claude-sonnet-4"
const successfulResult: AdapterEvent = {
  type: "result",
  subtype: "success",
  isError: false,
  durationMs: 2 * minute,
  numTurns: 1,
  stopReason: "end_turn",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
}
const harnesses: ReturnType<typeof createHarness>[] = []

afterEach(async () => {
  try {
    await Promise.all(harnesses.splice(0).map(({ host }) => host.dispose()))
  } finally {
    await removeTemporaryDirs()
  }
})

it("只在定时首轮自动拒绝批准，停放后仍能正常交互续接", async () => {
  const calls: { options: Options; sdk: FakeQuery }[] = []
  const prompts: SDKUserMessage[] = []
  const f = await fixture({
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ options, prompt }) => {
          const sdk = new FakeQuery([{ value: model, displayName: "Sonnet", description: "" }])
          if (options.persistSession) {
            calls.push({ options, sdk })
            void collectPrompt(prompt, prompts)
          }
          return sdk
        },
      }),
  })
  const finished = f.host.runScheduledTask(f.task, new AbortController().signal)
  await waitUntil(() => prompts.length === 1)
  const first = calls[0]
  const sessionId = first?.options.sessionId
  if (!first || !sessionId || !first.options.canUseTool) throw new Error("没有定时 SDK 查询")
  await waitUntil(() => f.host.status(sessionId).turnId !== null)
  expect(first.options).toMatchObject({
    model,
    permissionMode: "acceptEdits",
    persistSession: true,
  })
  expect(Object.keys(first.options.mcpServers ?? {})).toEqual([threadReadServerName])
  expect(prompts[0]?.message.content).toBe(f.task.prompt)
  expect(f.runtime.sessions[0]?.preferredAccountId).toBe("fixture-preferred-account")
  f.runtime.switchAccount(null, "fixture-actual-account", "initial", sessionId)
  const edit = { file_path: join(f.workspace, "fixture.txt"), old_string: "a", new_string: "b" }
  const question = {
    questions: [
      {
        question: "选择模拟输出？",
        header: "输出",
        multiSelect: false,
        options: [
          { label: "甲", description: "第一种" },
          { label: "乙", description: "第二种" },
        ],
      },
    ],
  }
  await expect(first.options.canUseTool("Edit", edit, askOptions())).resolves.toMatchObject({
    behavior: "deny",
    interrupt: false,
  })
  await expect(
    first.options.canUseTool("AskUserQuestion", question, askOptions()),
  ).resolves.toMatchObject({
    behavior: "deny",
    interrupt: false,
  })
  expect(f.host.status(sessionId)).toMatchObject({ pendingPermissions: 0, pendingQuestions: 0 })
  await expect(f.host.send(sessionId, { text: "并行交互输入" })).rejects.toMatchObject({
    code: "TURN_ACTIVE",
  })
  const result = loadSdkFixture("context-flags-2.1.310").find(
    (message) => message.type === "result",
  )
  if (!result) throw new Error("缺少 SDK 结果夹具")
  first.sdk.emit({ ...result, session_id: sessionId })

  await expect(finished).resolves.toMatchObject({
    status: "succeeded",
    sessionId,
    accountId: "fixture-actual-account",
    deniedApprovals: 2,
    sessionNoticeHandled: true,
  })
  expect(first.sdk.closes).toBe(1)
  expect(f.store.get(sessionId)).toMatchObject({ origin: "scheduled", status: "parked" })
  expect(f.host.list()).toContainEqual(expect.objectContaining({ sessionId, origin: "scheduled" }))
  const transcript = join(
    f.store.paths(sessionId).claudeConfigDir,
    "projects",
    retainedClaudeProject(sessionId),
  )
  await mkdir(transcript, { recursive: true })
  await writeFile(join(transcript, sessionId + ".jsonl"), '{"type":"fixture"}\n')
  await f.host.send(sessionId, { text: "查看定时结果" })
  const resumed = calls[1]?.options
  if (!resumed?.canUseTool) throw new Error("没有续接 SDK 查询")
  expect(resumed.resume).toBe(sessionId)
  const permission = resumed.canUseTool("Edit", edit, askOptions())
  await waitUntil(() => f.host.status(sessionId).pendingPermissions === 1)
  const request = f.events.find((event) => event.type === "permission")
  if (!request) throw new Error("交互询问没有发出")
  await f.host.respondPermission(sessionId, { requestId: request.requestId, decision: "allow" })
  await expect(permission).resolves.toMatchObject({ behavior: "allow" })
  expect(f.store.get(sessionId)?.origin).toBe("scheduled")
})

it("并发满时从入队开始等十五分钟，超时移出原队列且不启动定时会话", async () => {
  const f = await fixture({ limits: { maxRunningSessions: 1, maxQueuedSessions: 2 } })
  const peer = await startBusyPeer(f)
  const done = f.host.runScheduledTask(f.task, new AbortController().signal)
  await waitUntil(() => f.host.list().some(({ status }) => status === "queued"))
  f.clock.advance(15 * minute - 1)
  expect(f.host.list().filter(({ status }) => status === "queued")).toHaveLength(1)
  f.clock.advance(1)
  await expect(done).resolves.toMatchObject({ status: "skipped", reason: "CONCURRENCY_TIMEOUT" })
  expect(f.host.list().some(({ status }) => status === "queued")).toBe(false)
  await f.host.stop(peer)
  expect(f.adapters.instances).toHaveLength(1)
})

it("等待名额期间取消会释放队列请求，随后普通会话仍能正常拿到名额", async () => {
  const f = await fixture({ limits: { maxRunningSessions: 1, maxQueuedSessions: 1 } })
  const peer = await startBusyPeer(f)
  const abort = new AbortController()
  const done = f.host.runScheduledTask(f.task, abort.signal)
  await waitUntil(() => f.host.list().some(({ status }) => status === "queued"))
  abort.abort()
  await expect(done).resolves.toMatchObject({ status: "stopped", reason: "APP_STOPPED" })

  const next = startBusyPeer(f)
  await waitUntil(() => f.host.list().some(({ status }) => status === "queued"))
  await f.host.stop(peer)
  await next
  expect(f.adapters.instances).toHaveLength(2)
})

it("在十五分钟内得到名额后，原来的等待截止不会截断后台回合", async () => {
  const f = await fixture({ limits: { maxRunningSessions: 1, maxQueuedSessions: 1 } })
  const peer = await startBusyPeer(f)
  const done = f.host.runScheduledTask(f.task, new AbortController().signal)
  await waitUntil(() => f.host.list().some(({ status }) => status === "queued"))
  f.clock.advance(14 * minute)
  await f.host.stop(peer)
  await waitUntil(
    () => f.adapters.instances[1]?.sent.length === 1 && f.host.status().turnId !== null,
  )
  f.clock.advance(2 * minute)
  expect(f.host.status().turnId).not.toBeNull()
  f.adapters.last.emit(successfulResult)
  await expect(done).resolves.toMatchObject({ status: "succeeded", sessionNoticeHandled: true })
  expect(f.adapters.last.stops).toBe(1)
})

it("回合成功后停放失败时，先前的通知不能替代清理失败通知", async () => {
  const f = await fixture()
  const done = f.host.runScheduledTask(f.task, new AbortController().signal)
  await waitUntil(() => f.host.status().turnId !== null)
  vi.spyOn(f.adapters.last, "stop").mockRejectedValueOnce(new SessionClaudeExitError())
  f.adapters.last.emit(successfulResult)

  const outcome = await done
  expect(outcome).toMatchObject({ status: "failed", reason: "SESSION_STOP_FAILED" })
  expect(outcome.sessionNoticeHandled).toBeUndefined()
  expect(f.events).toContainEqual(
    expect.objectContaining({ type: "turn-ended", status: "completed" }),
  )
})

it("消息发送失败时保留已启动会话，结果不会认领没有发出的通知事件", async () => {
  const f = await fixture()
  f.adapters.onCreate((adapter) => {
    vi.spyOn(adapter, "send").mockRejectedValueOnce(new Error("fixture send failure"))
  })
  const outcome = await f.host.runScheduledTask(f.task, new AbortController().signal)
  expect(outcome).toMatchObject({
    status: "failed",
    reason: "SDK_ERROR",
    sessionId: expect.any(String),
  })
  expect(outcome.sessionNoticeHandled).toBeUndefined()
  expect(f.adapters.last.stops).toBe(1)
  if (!outcome.sessionId) throw new Error("已有会话没有写入结果")
  expect(f.store.get(outcome.sessionId)).toMatchObject({ origin: "scheduled", status: "parked" })
})

it("启动中的 SDK 错误已发出现场 ended 信封，结果记录通知归属", async () => {
  const f = await fixture()
  f.adapters.onCreate((adapter) => {
    vi.spyOn(adapter, "start").mockImplementationOnce(async () => {
      adapter.emit({ type: "ended", reason: "error" })
    })
  })
  const outcome = await f.host.runScheduledTask(f.task, new AbortController().signal)
  expect(outcome).toMatchObject({ status: "failed", sessionNoticeHandled: true })
  expect(f.events).toContainEqual({ type: "ended", reason: "error" })
  expect(f.runtime.sessions[0]?.closed).toBe(true)
})

async function fixture(options: Partial<Parameters<typeof createHarness>[0]> = {}) {
  const directory = await temporaryDir()
  const workspace = join(directory, "workspace")
  await mkdir(workspace)
  const store = await SessionStore.open({ root: join(directory, "sessions") })
  const clock = new ManualClock(fixedNow)
  const f = createHarness({
    workspace,
    userDataPath: directory,
    sessionStore: Promise.resolve(store),
    now: clock.now,
    timers: clock.timers,
    ...options,
  })
  harnesses.push(f)
  const task: ScheduledTaskInput = {
    projectPath: workspace,
    prompt: "汇总项目的合成测试结果",
    permissionMode: "acceptEdits",
    model,
    accountId: "fixture-preferred-account",
    rule: { kind: "daily", time: "09:00" },
    endsAt: null,
    enabled: true,
  }
  return { ...f, task, store, clock }
}

async function startBusyPeer(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const { sessionId } = await f.host.start({
    sessionId: randomUUID(),
    workspace: f.workspace,
    permissionMode: "default",
  })
  await f.host.send(sessionId, { text: "占用会话名额的合成消息" })
  return sessionId
}

function askOptions(): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID: "fixture-tool",
    requestId: "fixture-request",
  }
}
