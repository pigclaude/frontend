// 通过真实会话宿主和 MCP 内存传输验证能力插件工具、权限卡与 Worker 调用。

import { mkdir, realpath } from "node:fs/promises"
import { join } from "node:path"
import type { CanUseTool, Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, expect, it, vi } from "vitest"
import { parseCapabilityPluginManifest } from "../plugins/capability-plugin-manifest"
import type { CapabilityPluginSnapshot } from "../plugins/capability-plugin-manager"
import type { CapabilityPluginToolDependencies } from "../plugins/capability-plugin-tool-dependencies"
import {
  capabilityPluginServerName,
  capabilityPluginToolName,
} from "../plugins/capability-plugin-tool-name"
import {
  PluginSandboxError,
  type PluginSandboxJson,
  type PluginSandboxNetwork,
} from "../plugins/plugin-sandbox-contract"
import { ClaudeAgentAdapter } from "./claude-agent-adapter"
import { collectPrompt, FakeQuery } from "./claude-agent-adapter-fixtures"
import { createHarness } from "./session-host-fixtures"
import { loadSdkFixture } from "./session-replay-fixtures"
import { SessionStore } from "./session-store"
import { removeTemporaryDirs, temporaryDir } from "./session-store-fixtures"

const pluginId = "fixture.labels"
const tool = "label"
const serverName = capabilityPluginServerName(pluginId)
const qualifiedName = capabilityPluginToolName(pluginId, tool)
const args = { value: "AB" }
const inputSchema = {
  type: "object",
  properties: { value: { $ref: "#/$defs/label" } },
  required: ["value"],
  $defs: { label: { type: "string", pattern: "^[A-Z]{2}$" } },
  allOf: [{ minProperties: 1 }],
  additionalProperties: false,
}
const releases: Array<() => Promise<unknown>> = []

afterEach(async () => {
  try {
    await Promise.all(releases.splice(0).map((close) => close()))
  } finally {
    await removeTemporaryDirs()
  }
})

it("原样公布清单的 JSON Schema，完全访问时每次仍等待插件的一次性审批", async () => {
  const fixture = await pluginFixture()
  const { client, sessionId, canUseTool } = await start(fixture, "bypassPermissions")
  expect((await client.listTools()).tools).toEqual([
    {
      name: tool,
      description: "Read a fixture label",
      inputSchema,
      annotations: { destructiveHint: true },
    },
  ])
  expect(fixture.sdkServer(sessionId).tools).toEqual([
    { name: tool, permission_policy: "always_ask" },
  ])

  await expect(canUseTool(qualifiedName, args, askOptions())).resolves.toMatchObject({
    behavior: "allow",
  })
  expect(fixture.cards()).toHaveLength(0)
  const first = client.callTool({ name: tool, arguments: args })
  await vi.waitFor(() => expect(fixture.cards()).toHaveLength(1))
  const card = fixture.cards()[0]
  if (!card) throw new Error("缺少能力插件审批卡")
  expect(card).toMatchObject({
    toolName: qualifiedName,
    input: args,
    plugin: { id: pluginId, name: "标签插件" },
    defaultToNo: true,
  })
  expect(card.suggestions).toBeUndefined()
  expect(fixture.invoke).not.toHaveBeenCalled()
  await fixture.host.respondPermission(sessionId, { requestId: card.requestId, decision: "allow" })
  await expect(first).resolves.toEqual({ content: [{ type: "text", text: "标签 AB" }] })
  expect(fixture.invoke).toHaveBeenCalledWith(
    expect.objectContaining({ pluginId, revision: "fixture-revision-1", entry: "fixture.mjs" }),
    {
      operation: tool,
      input: { arguments: args, context: { sessionId, workspace: fixture.workspace } },
    },
    expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 15_000 }),
  )
  expect(fixture.pluginNetwork).not.toHaveBeenCalled()

  const second = client.callTool({ name: tool, arguments: args })
  await vi.waitFor(() => expect(fixture.cards()).toHaveLength(2))
  const next = fixture.cards()[1]
  if (!next) throw new Error("缺少第二次审批")
  expect(next.requestId).not.toBe(card.requestId)
  await fixture.host.respondPermission(sessionId, { requestId: next.requestId, decision: "deny" })
  await expect(second).resolves.toMatchObject({ isError: true })
  expect(fixture.invoke).toHaveBeenCalledTimes(1)
})

it("为各会话分别快照工具和询问档，跟随档由 SDK 询问时只出一张同来源的卡", async () => {
  const f = await pluginFixture()
  const first = await start(f, "default")
  const plugin = pluginSnapshot(f.userDataPath)
  f.replaceSnapshots([
    {
      ...plugin,
      toolApproval: "follow_session",
      manifest: {
        ...plugin.manifest,
        tools: [{ name: tool, description: "A new fixture revision", inputSchema }],
      },
    },
  ])
  const next = await start(f, "default")
  expect((await first.client.listTools()).tools[0]?.description).toBe("Read a fixture label")
  expect((await next.client.listTools()).tools[0]?.description).toBe("A new fixture revision")
  expect(f.sdkServer(first.sessionId).tools?.[0]?.permission_policy).toBe("always_ask")
  expect(f.sdkServer(next.sessionId).tools).toBeUndefined()

  const sdkApproval = next.canUseTool(qualifiedName, args, askOptions())
  const [card] = f.cards()
  if (!card) throw new Error("缺少 SDK 审批卡")
  expect(card.plugin).toEqual({ id: pluginId, name: "标签插件", toolName: tool })
  await f.host.respondPermission(next.sessionId, { requestId: card.requestId, decision: "allow" })
  await expect(sdkApproval).resolves.toMatchObject({ behavior: "allow" })
  await expect(next.client.callTool({ name: tool, arguments: args })).resolves.toMatchObject({
    content: [{ type: "text", text: "标签 AB" }],
  })
  expect(f.cards()).toHaveLength(1)

  const spoofed = first.canUseTool(qualifiedName, args, askOptions("project"))
  const untrusted = f.cards()[1]
  if (!untrusted) throw new Error("项目工具应进入普通权限卡")
  expect(untrusted.plugin).toBeUndefined()
  await f.host.respondPermission(first.sessionId, {
    requestId: untrusted.requestId,
    decision: "deny",
  })
  await expect(spoofed).resolves.toMatchObject({ behavior: "deny" })
  expect(f.invoke).toHaveBeenCalledTimes(1)
})

it("有效会员丢失后取消在等的审批与正在运行的插件调用", async () => {
  const f = await pluginFixture()
  const first = await start(f, "default")
  const pending = first.client.callTool({ name: tool, arguments: args })
  await vi.waitFor(() => expect(f.cards()).toHaveLength(1))
  f.membership.setState("network_grace")
  await expect(pending).resolves.toMatchObject({ isError: true })
  expect(f.host.status(first.sessionId).pendingPermissions).toBe(0)
  expect(f.invoke).not.toHaveBeenCalled()
  f.membership.setState("active")

  let running: AbortSignal | undefined
  f.invoke.mockImplementationOnce(async (_source, _request, options) => {
    running = options?.signal
    return new Promise((_resolve, reject) => {
      running?.addEventListener("abort", () => reject(new PluginSandboxError("PLUGIN_CANCELLED")))
    })
  })
  const active = first.client.callTool({ name: tool, arguments: args })
  await vi.waitFor(() => expect(f.cards()).toHaveLength(2))
  const card = f.cards()[1]
  if (!card) throw new Error("缺少能力插件审批")
  await f.host.respondPermission(first.sessionId, { requestId: card.requestId, decision: "allow" })
  await vi.waitFor(() => expect(running).toBeDefined())
  f.membership.setState("expired")
  await expect(active).resolves.toMatchObject({ isError: true })
  expect(running?.aborted).toBe(true)
})

it("只有已批准域名才解析本会话出口，Worker 失败和过大结果返回固定的 MCP 错误", async () => {
  const f = await pluginFixture()
  const plugin = pluginSnapshot(f.userDataPath)
  const domains = ["fixture.example.test"]
  f.replaceSnapshots([
    {
      ...plugin,
      approvedDomains: domains,
      toolApproval: "follow_session",
      manifest: { ...plugin.manifest, networkDomains: domains, permissions: ["network"] },
    },
  ])
  const route = (id: string): PluginSandboxNetwork => ({
    domains,
    egressId: id,
    permits: () => false,
    forward: async () => Response.error(),
  })
  f.pluginNetwork.mockImplementation(async (id) => route(id))
  f.invoke
    .mockRejectedValueOnce(new Error("合成进程内部详情"))
    .mockRejectedValueOnce(new PluginSandboxError("PLUGIN_TIMEOUT"))
    .mockResolvedValueOnce("字".repeat(200_000))
  const one = await start(f, "bypassPermissions")
  const two = await start(f, "bypassPermissions")
  await expect(one.client.callTool({ name: tool, arguments: args })).resolves.toEqual({
    isError: true,
    content: [{ type: "text", text: "The capability plugin could not complete this operation." }],
  })
  await expect(two.client.callTool({ name: tool, arguments: args })).resolves.toEqual({
    isError: true,
    content: [{ type: "text", text: "The capability plugin timed out." }],
  })
  await expect(two.client.callTool({ name: tool, arguments: args })).resolves.toEqual({
    isError: true,
    content: [{ type: "text", text: "The capability plugin result is too large." }],
  })
  expect(f.pluginNetwork.mock.calls.slice(0, 2)).toEqual(
    [one.sessionId, two.sessionId].map((id) => [
      id,
      { declaredDomains: domains, approvedDomains: domains },
    ]),
  )
  expect(f.invoke.mock.calls.slice(0, 2).map(([source]) => source.egressId)).toEqual([
    one.sessionId,
    two.sessionId,
  ])
  expect(f.cards()).toEqual([])
})

it("定时首轮拒绝 SDK 和 MCP 入口要求批准的操作，各自计一次且无待答卡", async () => {
  const f = await pluginFixture(true)
  const done = f.host.runScheduledTask(
    {
      projectPath: f.workspace,
      prompt: "读取合成标签",
      permissionMode: "bypassPermissions",
      model: "claude-sonnet-4",
      accountId: "fixture-account",
      rule: { kind: "daily", time: "09:00" },
      endsAt: null,
      enabled: true,
    },
    new AbortController().signal,
  )
  await vi.waitFor(() => expect(f.prompts[0]?.message.content).toBe("读取合成标签"))
  const sessionId = f.environments.inputs[0]?.sessionId
  if (!sessionId) throw new Error("缺少定时会话")
  const { options, sdk } = f.query(sessionId)
  if (!options.canUseTool) throw new Error("没有 SDK 权限入口")
  const client = await connect(f, sessionId)
  await expect(options.canUseTool(qualifiedName, args, askOptions())).resolves.toMatchObject({
    behavior: "deny",
    interrupt: false,
  })
  await expect(client.callTool({ name: tool, arguments: args })).resolves.toMatchObject({
    isError: true,
  })
  expect(f.cards()).toEqual([])
  expect(f.invoke).not.toHaveBeenCalled()
  const result = loadSdkFixture("context-flags-2.1.310").find(
    (message) => message.type === "result",
  )
  if (!result) throw new Error("缺少 SDK 结果夹具")
  sdk.emit({ ...result, session_id: sessionId })
  await expect(done).resolves.toMatchObject({ status: "succeeded", deniedApprovals: 2 })
})

async function pluginFixture(persist = false) {
  const directory = await temporaryDir()
  const workspace = join(directory, "workspace")
  await mkdir(workspace)
  const invoke = vi
    .fn<CapabilityPluginToolDependencies["sandbox"]["invoke"]>()
    .mockResolvedValue("标签 AB" satisfies PluginSandboxJson)
  const canInvoke = vi
    .fn<CapabilityPluginToolDependencies["manager"]["canInvoke"]>()
    .mockResolvedValue(true)
  let snapshots = [pluginSnapshot(directory)]
  const pluginNetwork = vi.fn<CapabilityPluginToolDependencies["pluginNetwork"]>()
  const store = persist ? await SessionStore.open({ root: join(directory, "sessions") }) : undefined
  const calls: Array<{ options: Options; sdk: FakeQuery }> = []
  const prompts: SDKUserMessage[] = []
  const fixture = createHarness({
    workspace: await realpath(workspace),
    userDataPath: directory,
    ...(store === undefined ? {} : { sessionStore: Promise.resolve(store) }),
    capabilityPluginTools: {
      manager: { snapshotEnabled: async () => structuredClone(snapshots), canInvoke },
      sandbox: { invoke },
      pluginNetwork,
    },
    createAdapter: (onEvent) =>
      new ClaudeAgentAdapter({
        onEvent,
        queryFn: ({ options, prompt }) => {
          const sdk = new FakeQuery()
          if (typeof prompt !== "string") {
            calls.push({ options, sdk })
            void collectPrompt(prompt, prompts)
          }
          return sdk
        },
      }),
  })
  const query = (sessionId: string) => {
    const adapterIndex = fixture.environments.inputs.findIndex(
      (input) => input.sessionId === sessionId,
    )
    const call = calls[adapterIndex]
    if (!call) throw new Error("SDK 未启动对应会话")
    return call
  }
  releases.push(() => fixture.host.dispose())
  return {
    ...fixture,
    invoke,
    canInvoke,
    pluginNetwork,
    query,
    prompts,
    cards: () => fixture.events.filter((event) => event.type === "permission"),
    replaceSnapshots: (next: CapabilityPluginSnapshot[]) => {
      snapshots = next
    },
    sdkServer(sessionId: string) {
      const server = query(sessionId).options.mcpServers?.[serverName]
      if (server?.type !== "sdk") throw new Error("没有向 SDK 登记进程内能力插件服务")
      return server
    },
  }
}

function pluginSnapshot(directory: string): CapabilityPluginSnapshot {
  return {
    manifest: parseCapabilityPluginManifest({
      apiVersion: 1,
      id: pluginId,
      name: "标签插件",
      version: "1.0.0",
      pigclaudeVersion: "*",
      entry: "fixture.mjs",
      tools: [{ name: tool, description: "Read a fixture label", inputSchema }],
    }),
    revision: "fixture-revision-1",
    modules: { "fixture.mjs": "export default () => '标签 AB'" },
    approvedDomains: [],
    dataDirectory: join(directory, "data"),
    secretsFile: join(directory, "secrets"),
    toolApproval: "always_ask",
  }
}

async function start(
  fixture: Awaited<ReturnType<typeof pluginFixture>>,
  permissionMode: "default" | "bypassPermissions",
) {
  const { sessionId } = await fixture.host.start({ workspace: fixture.workspace, permissionMode })
  const { options } = fixture.query(sessionId)
  if (!options.canUseTool) throw new Error("SDK 没收到权限入口")
  const client = await connect(fixture, sessionId)
  await fixture.host.send(sessionId, { text: "读取合成标签" })
  return { client, sessionId, canUseTool: options.canUseTool }
}

async function connect(fixture: Awaited<ReturnType<typeof pluginFixture>>, sessionId: string) {
  const { instance } = fixture.sdkServer(sessionId)
  const client = new Client({ name: "fixture", version: "1" })
  const [remote, local] = InMemoryTransport.createLinkedPair()
  releases.push(async () => {
    await client.close()
    await instance.close()
  })
  await instance.connect(local)
  await client.connect(remote)
  return client
}

function askOptions(source = "sdk"): Parameters<CanUseTool>[2] {
  return {
    signal: new AbortController().signal,
    toolUseID: "fixture-tool",
    requestId: "fixture-request",
    mcpServer: { name: serverName, source },
  }
}
