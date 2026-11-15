// 穿过真实会话环境和假 SDK 观察启用的 Claude Code 插件与本次启动目录。
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { FakeQuery, capture, type CapturedQuery } from "./claude-agent-adapter-fixtures"
import { readCommandCatalog, trackSessionCommandCatalogs } from "./session-command-catalogs"
import { retainedClaudeProject } from "./session-environment"
import { SessionStore } from "./session-store"
import { createHarness } from "./session-host-fixtures"

it("新会话把已启用插件的私有副本交给 SDK，停止后删除副本", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-session-plugin-"))
  const workspace = join(root, "workspace")
  await mkdir(workspace)
  const stage = vi.fn(async (directory: string) => {
    const path = join(directory, "fixture")
    await mkdir(path)
    await writeFile(join(path, "marker.md"), "合成提示")
    return [path]
  })
  const queries: CapturedQuery[] = []
  const { host } = createHarness({
    workspace,
    userDataPath: root,
    useRealEnvironment: true,
    claudeCodePlugins: { stage, commands: async () => ["fixture:describe"] },
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({ onEvent, queryFn: capture(new FakeQuery(), queries) }),
  })
  try {
    const { sessionId } = await host.start({ workspace, permissionMode: "default" })
    const path = queries[0]?.options.plugins?.[0]?.path
    expect(queries[0]?.options).toMatchObject({
      plugins: [{ type: "local" }],
      settingSources: ["project"],
      strictMcpConfig: true,
      projectConfigRoot: expect.any(String),
    })
    if (!path) throw new Error("没有把插件目录交给 SDK")
    expect(stage).toHaveBeenCalledOnce()
    await expect(readFile(join(path, "marker.md"), "utf8")).resolves.toBe("合成提示")
    await host.stop(sessionId)
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it("草稿取当前启用项，活跃会话取 SDK，续接才换一份插件副本", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-session-plugin-"))
  const workspace = join(root, "workspace")
  const projectCommands = join(workspace, ".claude", "commands")
  await mkdir(projectCommands, { recursive: true })
  await writeFile(join(projectCommands, "inspect.md"), "PROJECT_COMMAND")
  const store = await SessionStore.open({ root: join(root, "store") })
  const directories: string[] = []
  const queries: CapturedQuery[] = []
  const sdks: FakeQuery[] = []
  let enabled = ["first"]
  const source = {
    stage: vi.fn(async (directory: string) => {
      directories.push(directory)
      return Promise.all(
        enabled.map(async (name) => {
          const path = join(directory, name)
          await mkdir(path)
          return path
        }),
      )
    }),
    commands: vi.fn(async () => enabled.flatMap((name) => [name + ":describe", name + ":review"])),
  }
  const { host } = createHarness({
    workspace,
    userDataPath: root,
    useRealEnvironment: true,
    sessionStore: Promise.resolve(store),
    claudeCodePlugins: source,
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: (call) => {
          queries.push(call)
          const sdk = new FakeQuery()
          sdks.push(sdk)
          return sdk
        },
      }),
  })
  trackSessionCommandCatalogs(host, source)
  try {
    const sessionId = randomUUID()
    const draftNames = async () =>
      (await readCommandCatalog(host, workspace)).map(({ text }) => text)
    await expect(draftNames()).resolves.toEqual(
      expect.arrayContaining(["/first:describe", "/first:review", "/inspect"]),
    )
    expect(source.stage).not.toHaveBeenCalled()

    await host.start({ sessionId, workspace, permissionMode: "default" })
    const first = sdks[0]
    const firstRoot = directories[0]
    if (!first || !firstRoot) throw new Error("没有启动首个假 CLI")
    expect(queries[0]?.options.plugins).toEqual([{ type: "local", path: join(firstRoot, "first") }])

    const runningNames = async () =>
      (await readCommandCatalog(host, workspace, sessionId)).map(({ text }) => text)
    await expect(runningNames()).resolves.not.toContain("/first:review")
    first.emit({
      type: "system",
      subtype: "commands_changed",
      commands: [{ name: "first:describe", description: "", argumentHint: "", builtin: false }],
      session_id: sessionId,
      uuid: randomUUID(),
    })
    await vi.waitFor(async () => expect(await runningNames()).toEqual(["/first:describe"]))
    expect(source.commands).toHaveBeenCalledTimes(1)

    enabled = ["next"]
    const updatedDraft = await draftNames()
    expect(updatedDraft).toEqual(
      expect.arrayContaining(["/next:describe", "/next:review", "/inspect"]),
    )
    expect(updatedDraft).not.toContain("/first:describe")
    await expect(runningNames()).resolves.toEqual(["/first:describe"])
    expect(source.stage).toHaveBeenCalledTimes(1)
    await expect(stat(join(firstRoot, "first"))).resolves.toBeDefined()

    const project = join(
      store.paths(sessionId).claudeConfigDir,
      "projects",
      retainedClaudeProject(sessionId),
    )
    await mkdir(project, { recursive: true })
    const transcript = join(project, sessionId + ".jsonl")
    await writeFile(transcript, '{"type":"fixture"}\n')
    await host.stop(sessionId)
    await expect(stat(firstRoot)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(stat(transcript)).resolves.toBeDefined()

    await host.send(sessionId, { text: "续接合成会话" })
    expect(source.stage).toHaveBeenCalledTimes(2)
    const nextRoot = directories[1]
    if (!nextRoot) throw new Error("没有续接插件目录")
    expect(nextRoot).not.toBe(firstRoot)
    expect(queries.find(({ options }) => options.resume === sessionId)?.options.plugins).toEqual([
      { type: "local", path: join(nextRoot, "next") },
    ])
    await expect(stat(join(nextRoot, "next"))).resolves.toBeDefined()
  } finally {
    try {
      await host.dispose()
      for (const directory of directories)
        await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

it("插件准备失败会清除已写出的那次副本并撤销会话令牌", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-session-plugin-"))
  const workspace = join(root, "workspace")
  await mkdir(workspace)
  let staged: string | undefined
  const f = createHarness({
    workspace,
    userDataPath: root,
    useRealEnvironment: true,
    claudeCodePlugins: {
      async stage(directory) {
        staged = directory
        await writeFile(join(directory, "partial.md"), "不可加载的合成文件")
        throw new Error("合成写入失败")
      },
      commands: async () => [],
    },
  })
  try {
    await expect(f.host.start({ workspace, permissionMode: "default" })).rejects.toMatchObject({
      code: "SESSION_START_FAILED",
    })
    if (!staged) throw new Error("没有进入插件准备")
    await expect(stat(staged)).rejects.toMatchObject({ code: "ENOENT" })
    expect(f.runtime.sessions.map(({ closed }) => closed)).toEqual([true])
  } finally {
    await f.host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
