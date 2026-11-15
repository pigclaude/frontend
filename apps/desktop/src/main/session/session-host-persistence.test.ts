// 验证宿主用真实会话存储和假的 SDK 启动、停放和续接会话，打开历史时不创建查询进程。

import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setImmediate } from "node:timers/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { deferred } from "../testing/profile-fixture"
import type { FakeQuery } from "./claude-agent-adapter-fixtures"
import { retainedClaudeProject } from "./session-environment"
import type { SessionHost } from "./session-host"
import { waitUntil } from "./session-host-fixtures"
import { loadSdkFixture } from "./session-replay-fixtures"
import { SessionStore } from "./session-store"
import { newSessionIndex } from "./session-store-fixtures"
import {
  disposePersistenceFixtures,
  hostFixture,
  savedModel,
  workspaceFixture,
} from "./session-host-persistence-fixture"

const savedProfile = {
  timezone: "America/New_York",
  locale: "fr-FR",
  browserProfileId: "profile-orig",
  profileRevision: 3,
  accountId: "account-orig",
}
const otherProfile = { ...savedProfile, timezone: "Asia/Tokyo", locale: "ja-JP" }
const transcriptFixture = '{"type":"fixture"}\n'
afterEach(disposePersistenceFixtures)

describe("SessionHost 保存与续接", () => {
  it("保留已归档的运行会话，省略自动标题并在审批取消时刷新摘要", async () => {
    const fixture = await workspaceFixture()
    const { host, queries } = hostFixture(fixture, async () => savedProfile)
    const { sessionId } = await host.start({
      workspace: fixture.workspace,
      projectPath: fixture.project,
      permissionMode: "default",
    })
    await fixture.store.update(sessionId, { title: "来自用户提示词的标题", titleSource: "auto" })
    await host.history.archive(sessionId, true)
    expect(host.list()).toEqual([])
    expect(host.livePreviews()).toEqual([
      { sessionId, projectName: "project", title: null, pendingApprovals: 0 },
    ])
    await host.history.rename(sessionId, "手动命名")
    const counts: number[] = []
    const unsubscribe = host.subscribe(({ event }) => {
      if (event.type === "permission" || event.type === "sessions-changed")
        counts.push(host.livePreviews()[0]?.pendingApprovals ?? 0)
    })
    const request = queries[0]?.options.canUseTool
    if (!request) throw new Error("会话未安装审批回调")
    const abort = new AbortController()
    const pending = request(
      "Read",
      { file_path: "fixture.txt" },
      { signal: abort.signal, toolUseID: "tool-1", requestId: "ask-1" },
    )
    await waitUntil(() => counts.includes(1))
    expect(host.livePreviews()).toEqual([
      { sessionId, projectName: "project", title: "手动命名", pendingApprovals: 1 },
    ])
    abort.abort()
    await expect(pending).resolves.toMatchObject({ behavior: "deny" })
    expect(counts).toEqual([1, 0])
    unsubscribe()
    await host.stop(sessionId)
    expect(host.livePreviews()).toEqual([])
  })

  it("退出时先保存中断的回合，再关闭 SDK 查询进程", async () => {
    const fixture = await workspaceFixture()
    const { host, sessions } = hostFixture(fixture, async () => savedProfile)
    const { sessionId } = await host.start({
      workspace: fixture.workspace,
      permissionMode: "default",
    })
    await host.send(sessionId, { text: "退出前要保存的消息" })
    const query = sessions[0]
    if (!query) throw new Error("没有建立会话查询")
    const writing = deferred<void>()
    const allowWrite = deferred<void>()
    const appendTimeline = fixture.store.appendTimeline.bind(fixture.store)
    vi.spyOn(fixture.store, "appendTimeline").mockImplementation(async (id, envelope) => {
      if (envelope.event.type === "turn-ended") {
        writing.resolve()
        await allowWrite.promise
      }
      return appendTimeline(id, envelope)
    })
    const quitting = host.dispose()
    try {
      await writing.promise
      await setImmediate()
      expect(query.closes).toBe(0)
    } finally {
      allowWrite.resolve()
      await quitting
    }
    expect(query.closes).toBe(1)
    expect(fixture.store.get(sessionId)).toMatchObject({
      status: "interrupted",
      lastTurn: { status: "interrupted" },
    })
  })

  it.each(["partial", "committed", "index"] as const)(
    "%s：保存中断回合失败后保留 SDK，重试后时间线只追加一次",
    async (failure) => {
      const fixture = await workspaceFixture()
      const { host, sessions } = hostFixture(fixture, async () => savedProfile)
      const { sessionId } = await host.start({
        workspace: fixture.workspace,
        permissionMode: "default",
      })
      await host.send(sessionId, { text: "磁盘恢复后还要保存的消息" })
      const query = sessions[0]
      if (!query) throw new Error("没有建立会话查询")
      const path = fixture.store.paths(sessionId).timelineFile
      let diskUnavailable = true
      let reachedTurnEnd = false
      const appendTimeline = fixture.store.appendTimeline.bind(fixture.store)
      vi.spyOn(fixture.store, "appendTimeline").mockImplementation(async (...args) => {
        const [, envelope] = args
        if (envelope.event.type !== "turn-ended") return appendTimeline(...args)
        const firstAttempt = !reachedTurnEnd
        reachedTurnEnd = true
        if (!diskUnavailable || failure === "index") return appendTimeline(...args)
        if (firstAttempt && failure === "partial")
          await appendFile(path, JSON.stringify(envelope).slice(0, -4))
        if (firstAttempt && failure === "committed") await appendTimeline(...args)
        throw new Error("fixture disk unavailable")
      })
      const update = fixture.store.update.bind(fixture.store)
      vi.spyOn(fixture.store, "update").mockImplementation(async (...args) => {
        if (diskUnavailable && reachedTurnEnd && failure === "index")
          throw new Error("fixture index unavailable")
        return update(...args)
      })

      try {
        await expect(host.dispose()).rejects.toThrow("会话记录写入失败")
        expect(query.closes).toBe(0)
        expect(await host.historyEvents(sessionId, 0)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: expect.objectContaining({
                type: "turn-started",
                userText: "磁盘恢复后还要保存的消息",
              }),
            }),
          ]),
        )
      } finally {
        diskUnavailable = false
      }
      await host.dispose()

      expect(query.closes).toBe(1)
      expect(fixture.store.get(sessionId)).toMatchObject({
        status: "interrupted",
        lastTurn: { status: "interrupted" },
      })
      expect((await readFile(path, "utf8")).match(/"type":"turn-ended"/g)).toHaveLength(1)
      expect(await fixture.store.readTimeline(sessionId)).toMatchObject({ skippedLines: 0 })
    },
  )

  it("SDK 关闭后停放状态写入失败仍阻止退出，重试只补写索引", async () => {
    const fixture = await workspaceFixture()
    const { host, sessions } = hostFixture(fixture, async () => savedProfile)
    const { sessionId } = await host.start({
      workspace: fixture.workspace,
      permissionMode: "default",
    })
    await host.send(sessionId, { text: "先保存回合，然后写入停放状态" })
    const query = sessions[0]
    if (!query) throw new Error("没有建立会话查询")
    const update = fixture.store.update.bind(fixture.store)
    let diskUnavailable = true
    vi.spyOn(fixture.store, "update").mockImplementation(async (id, patch) => {
      if (diskUnavailable && typeof patch !== "function" && patch.status === "interrupted")
        throw new Error("fixture park index unavailable")
      return update(id, patch)
    })

    try {
      await expect(host.dispose()).rejects.toThrow("会话记录写入失败")
      expect(query.closes).toBe(1)
      expect(fixture.store.get(sessionId)?.lastTurn).toMatchObject({ status: "interrupted" })
    } finally {
      diskUnavailable = false
    }
    await host.dispose()
    expect(query.closes).toBe(1)
    expect(fixture.store.get(sessionId)?.status).toBe("interrupted")
  })

  it("会员失效时磁盘写入失败也停止 SDK 并吊销会话令牌", async () => {
    const fixture = await workspaceFixture()
    const { host, membership, sessions, runtime } = hostFixture(fixture, async () => savedProfile)
    const { sessionId } = await host.start({
      workspace: fixture.workspace,
      permissionMode: "default",
    })
    await host.send(sessionId, { text: "只用于会员失效的合成消息" })
    const appendTimeline = fixture.store.appendTimeline.bind(fixture.store)
    vi.spyOn(fixture.store, "appendTimeline").mockImplementation(async (...args) => {
      if (args[1].event.type === "turn-ended") throw new Error("fixture disk unavailable")
      return appendTimeline(...args)
    })

    membership.setState("expired")
    await waitUntil(() => runtime.sessions[0]?.closed === true)

    expect(sessions[0]?.closes).toBe(1)
    expect(runtime.sessions[0]?.closed).toBe(true)
  })

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
    const canonicalWorkspace = await realpath(fixture.workspace)
    expect(original.queries[0]?.options).toMatchObject({
      sessionId,
      persistSession: true,
      cwd: canonicalWorkspace,
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
    await original.host.setMode(sessionId, "default")
    await original.host.setMode(sessionId, "bypassPermissions")
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
      workspace: canonicalWorkspace,
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
        event: expect.objectContaining({ type: "started", permissionMode: "bypassPermissions" }),
      }),
    )
    expect(
      page.flatMap(({ event }) => (event.type === "mode" ? [event.permissionMode] : [])).slice(-3),
    ).toEqual(["default", "bypassPermissions", "plan"])
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
        workspace: canonicalWorkspace,
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
      cwd: canonicalWorkspace,
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
