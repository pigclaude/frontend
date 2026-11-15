// 验证宿主用真实会话存储和假的 SDK 启动、停放和续接会话，打开历史时不创建查询进程。

import { randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { collectPrompt, FakeQuery, type CapturedQuery } from "./claude-agent-adapter-fixtures"
import type { SessionFlagSettings } from "./claude-query"
import { retainedClaudeProject } from "./session-environment"
import { SessionHost, type SessionHostOptions } from "./session-host"
import { FakeMembership, FakeUsage, waitUntil } from "./session-host-fixtures"
import { loadSdkFixture } from "./session-replay-fixtures"
import { FakeRuntime } from "./session-runtime-fixture"
import { SessionStore } from "./session-store"
import { newSessionIndex, removeTemporaryDirs, temporaryDir } from "./session-store-fixtures"

const savedModel = "claude-sonnet-4"
const savedProfile = {
  timezone: "America/New_York",
  locale: "fr-FR",
  browserProfileId: "profile-orig",
  profileRevision: 3,
  accountId: "account-orig",
}
const otherProfile = { ...savedProfile, timezone: "Asia/Tokyo", locale: "ja-JP" }
const transcriptFixture = '{"type":"fixture"}\n'
const hosts: SessionHost[] = []

afterEach(async () => {
  const open = hosts.splice(0)
  try {
    await Promise.all(open.map((host) => host.dispose()))
  } finally {
    await removeTemporaryDirs()
  }
})

describe("SessionHost 保存与续接", () => {
  it("等待 Agent 浏览器回收才完成停放，续接给新工具同一个实际会话 id", async () => {
    const fixture = await workspaceFixture()
    const { host } = hostFixture(fixture, async () => savedProfile)
    const sessionId = randomUUID()
    const ids: string[] = []
    const create = (_approval: unknown, id: string) => {
      ids.push(id)
      return {}
    }
    let finish = () => {}
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    await host.start(
      { sessionId, workspace: fixture.workspace, permissionMode: "default" },
      {
        browser: { create },
        close: cleanup,
      },
    )
    await writeTranscript(fixture.store, sessionId)
    let parked = false
    const stopping = host.stop(sessionId).then(() => {
      parked = true
    })
    try {
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
      expect(parked).toBe(false)
    } finally {
      finish()
      await stopping
    }
    await host.send(sessionId, { text: "继续这个会话" }, undefined, () => ({
      browser: { create },
      close: () => undefined,
    }))
    expect(ids).toEqual([sessionId, sessionId])
  })

  it("保存用户正文，停放后重开可只读历史，下一次发送用原环境打开同一个会话", async () => {
    const fixture = await workspaceFixture()
    const original = hostFixture(fixture, async () => savedProfile)
    const sessionId = randomUUID()
    const firstText = "整理项目里的发布清单"
    const firstStart = {
      sessionId,
      workspace: fixture.workspace,
      projectPath: fixture.project,
      model: savedModel,
      permissionMode: "bypassPermissions" as const,
      accountId: savedProfile.accountId,
    }
    await expect(original.host.start(firstStart)).resolves.toEqual({ sessionId })
    const paths = fixture.store.paths(sessionId)
    expect(original.queries[0]?.options).toMatchObject({
      sessionId,
      persistSession: true,
      cwd: fixture.workspace,
      env: {
        CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
        CLAUDE_CODE_PROJECT_DIR_NAME: retainedClaudeProject(sessionId),
        CLAUDE_CODE_TMPDIR: paths.claudeTmpDir,
      },
    })
    expect(original.queries[0]?.options.resume).toBeUndefined()

    await original.host.send(sessionId, { text: firstText, effort: "high", fast: true })
    const firstQuery = original.sessions[0]
    if (firstQuery === undefined) throw new Error("没有建立会话查询")
    expect(firstQuery.flagSettings).toEqual([{ effortLevel: "high", fastMode: true }])
    await finishTurn(original.host, firstQuery, sessionId, "bypassPermissions", 16)
    expect(original.usage.records.map(({ inputTokens }) => inputTokens)).toEqual([16])
    await original.host.setMode(sessionId, "plan")
    const transcript = await writeTranscript(fixture.store, sessionId)
    await original.host.stop(sessionId)
    expect(original.runtime.sessions[0]?.closed).toBe(true)
    expect(await readFile(transcript, "utf8")).toBe(transcriptFixture)

    const before = await SessionStore.open({ root: fixture.root })
    expect(before.get(sessionId)).toMatchObject({
      status: "parked",
      title: firstText,
      projectPath: fixture.project,
      workspace: fixture.workspace,
      effort: "high",
      fast: true,
      permissionMode: "bypassPermissions",
      planMode: true,
      environment: { timezone: savedProfile.timezone, locale: savedProfile.locale },
    })
    for (const path of [paths.directory, paths.claudeConfigDir, paths.claudeTmpDir]) {
      expect((await stat(path)).isDirectory()).toBe(true)
    }
    await original.host.dispose()

    const requests: Array<{ accountId: string | null; required: unknown }> = []
    const reopened = hostFixture({ ...fixture, store: before }, async (accountId, required) => {
      requests.push({ accountId, required })
      if (required === undefined) return otherProfile
      return { ...savedProfile, browserProfileId: "current-profile", profileRevision: 9 }
    })
    await reopened.host.ready()
    const page = await reopened.host.historyEvents(sessionId, 0)
    expect(page).toContainEqual(
      expect.objectContaining({
        sessionId,
        event: expect.objectContaining({ type: "turn-started", userText: firstText }),
      }),
    )
    const afterFirst = page[0]?.seq
    if (afterFirst == null) throw new Error("历史没有事件序号")
    expect(await reopened.host.historyEvents(sessionId, afterFirst)).toEqual(page.slice(1))
    expect(await reopened.host.list()).toContainEqual(
      expect.objectContaining({
        sessionId,
        status: "parked",
        title: firstText,
        projectPath: fixture.project,
        workspace: fixture.workspace,
        restorable: true,
      }),
    )
    expect(reopened.queries).toHaveLength(0)
    expect(reopened.runtime.sessions).toHaveLength(0)

    await reopened.host.send(sessionId, { text: "继续核对已有清单" })
    const resumed = reopened.queries.find(({ options }) => options.resume === sessionId)
    expect(resumed?.options).toMatchObject({
      persistSession: true,
      resume: sessionId,
      cwd: fixture.workspace,
      permissionMode: "default",
      model: savedModel,
      effort: "high",
      settings: { fastMode: true },
      env: {
        TZ: savedProfile.timezone,
        LANG: process.platform === "win32" ? "fr-FR" : "fr_FR.UTF-8",
        CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
      },
    })
    expect(resumed?.options.sessionId).toBeUndefined()
    expect(requests).toContainEqual({
      accountId: savedProfile.accountId,
      required: expect.objectContaining({
        timezone: savedProfile.timezone,
        locale: savedProfile.locale,
      }),
    })
    expect(reopened.runtime.sessions.find(({ sessionId: id }) => id === sessionId)?.bound).toEqual([
      expect.objectContaining({
        timezone: savedProfile.timezone,
        locale: savedProfile.locale,
        browserProfileId: "current-profile",
        profileRevision: 9,
      }),
    ])
    await waitUntil(() => reopened.prompts.length === 1)
    expect(reopened.prompts[0]?.message.content).toBe("继续核对已有清单")
    expect(await readFile(transcript, "utf8")).toBe(transcriptFixture)

    const resumedQuery = reopened.sessions[0]
    if (resumedQuery === undefined) throw new Error("没有建立续接查询")
    await finishTurn(reopened.host, resumedQuery, sessionId, "default", 23)
    expect(reopened.usage.records.map(({ inputTokens }) => inputTokens)).toEqual([7])
    await reopened.host.stop(sessionId)
    const reopenedAgain = await SessionStore.open({ root: fixture.root })
    expect(reopenedAgain.get(sessionId)).toMatchObject({
      status: "parked",
      model: savedModel,
      effort: "high",
      fast: true,
      permissionMode: "default",
      planMode: false,
    })
    const afterLast = page.at(-1)?.seq
    if (afterLast == null) throw new Error("历史没有结束事件")
    const { envelopes } = await reopenedAgain.readTimeline(sessionId, { afterSeq: afterLast })
    expect(envelopes[0]?.seq).toBe(afterLast + 1)
    expect(envelopes.map(({ event }) => event)).toContainEqual(
      expect.objectContaining({ type: "turn-started", userText: "继续核对已有清单" }),
    )
  })

  it("没有同语言时区的账号时拒绝续接并保持原目录和索引", async () => {
    const fixture = await workspaceFixture()
    const sessionId = randomUUID()
    await fixture.store.create(
      newSessionIndex(sessionId, {
        workspace: fixture.workspace,
        projectPath: fixture.project,
        model: savedModel,
        environment: {
          timezone: savedProfile.timezone,
          locale: savedProfile.locale,
          browserProfileId: savedProfile.browserProfileId,
          browserProfileRevision: savedProfile.profileRevision,
        },
      }),
    )
    const transcript = await writeTranscript(fixture.store, sessionId)
    const indexPath = fixture.store.paths(sessionId).indexFile
    const original = await readFile(indexPath, "utf8")
    const { host, queries, runtime } = hostFixture(fixture, async () => otherProfile)

    await expect(host.send(sessionId, { text: "继续" })).rejects.toMatchObject({
      message: expect.stringContaining("原语言和时区"),
    })
    expect(queries).toHaveLength(0)
    expect(runtime.sessions).toHaveLength(0)
    expect(await readFile(transcript, "utf8")).toBe(transcriptFixture)
    expect(await readFile(indexPath, "utf8")).toBe(original)
  })
})

async function workspaceFixture() {
  const userDataPath = await temporaryDir()
  const root = join(userDataPath, "session-store")
  const project = join(userDataPath, "project")
  const workspace = join(userDataPath, "worktree")
  await Promise.all([mkdir(project), mkdir(workspace)])
  return { userDataPath, root, project, workspace, store: await SessionStore.open({ root }) }
}

class PersistenceQuery extends FakeQuery {
  readonly flagSettings: SessionFlagSettings[] = []

  async applyFlagSettings(settings?: SessionFlagSettings): Promise<void> {
    if (settings !== undefined) this.flagSettings.push(settings)
  }
}

function hostFixture(
  fixture: Awaited<ReturnType<typeof workspaceFixture>>,
  resolveProfile: NonNullable<SessionHostOptions["resolveProfile"]>,
) {
  const queries: CapturedQuery[] = []
  const sessions: PersistenceQuery[] = []
  const prompts: SDKUserMessage[] = []
  const runtime = new FakeRuntime()
  const usage = new FakeUsage()
  const host = new SessionHost({
    membership: new FakeMembership(),
    runtime,
    usage,
    userDataPath: fixture.userDataPath,
    defaultWorkspace: () => fixture.workspace,
    resolveBinaryPath: () => join(fixture.userDataPath, "fake-claude"),
    resolveProfile,
    readOrganizationModels: async () => [],
    sessionStore: Promise.resolve(fixture.store),
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ options, prompt }) => {
          queries.push({ options, prompt })
          const query = new PersistenceQuery([
            { value: savedModel, displayName: "Sonnet", description: "已保存模型" },
          ])
          if (options.persistSession) {
            sessions.push(query)
            void collectPrompt(prompt, prompts)
          }
          return query
        },
      }),
  })
  hosts.push(host)
  return { host, queries, prompts, sessions, runtime, usage }
}

async function writeTranscript(store: SessionStore, sessionId: string): Promise<string> {
  const paths = store.paths(sessionId)
  const project = join(paths.claudeConfigDir, "projects", retainedClaudeProject(sessionId))
  await mkdir(project, { recursive: true })
  const transcript = join(project, `${sessionId}.jsonl`)
  await writeFile(transcript, transcriptFixture)
  return transcript
}

async function finishTurn(
  host: SessionHost,
  query: FakeQuery,
  sessionId: string,
  permissionMode: "default" | "bypassPermissions",
  inputTokens: number,
): Promise<void> {
  const trace = loadSdkFixture("context-flags-2.1.310")
  const init = trace.find((message) => message.type === "system" && message.subtype === "init")
  const result = trace.find((message) => message.type === "result")
  if (!init || !result) throw new Error("录制的 SDK 消息缺少初始化或结果")
  const modelUsage = Object.values(result.modelUsage)[0]
  if (!modelUsage) throw new Error("录制的 SDK 消息没有模型用量")
  query.emit({ ...init, session_id: sessionId, model: savedModel, permissionMode })
  query.emit({
    ...result,
    session_id: sessionId,
    modelUsage: { [savedModel]: { ...modelUsage, inputTokens } },
  })
  await waitUntil(() => host.status(sessionId).turnId === null)
}
