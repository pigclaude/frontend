// 通过真实管理器验证管理 IPC 的受信来源、原生来源选择和 frame 绑定确认。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type {
  CapabilityPluginInstallDisclosure,
  InstalledCapabilityPlugin,
} from "../../capability-plugin-contract"
import {
  capabilityPluginChannelPrefix,
  capabilityPluginManifestFile,
} from "../../capability-plugin-contract"
import { CapabilityPluginDeclarationHost } from "./capability-plugin-declarations"
import { createCapabilityPluginSecrets } from "./capability-plugin-secrets"
import { CapabilityPluginSettings } from "./capability-plugin-settings"
import { capabilityPluginToolName } from "./capability-plugin-tool-name"
import { registerCapabilityPluginIpc } from "./capability-plugin-ipc"
import { CapabilityPluginManager } from "./capability-plugin-manager"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
const native = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  window: {},
  showOpenDialog: vi.fn(),
}))

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => native.window },
  dialog: { showOpenDialog: native.showOpenDialog },
  ipcMain: { handle: (channel: string, handler: Handler) => native.handlers.set(channel, handler) },
}))

const owner = { senderFrame: {} } as IpcMainInvokeEvent
const nextPage = { senderFrame: {} } as IpcMainInvokeEvent
const stray = { senderFrame: {} } as IpcMainInvokeEvent
let directory: string
let manager: CapabilityPluginManager | null
let declarations: CapabilityPluginDeclarationHost | null
const sandboxInvoke = vi.fn()
const pluginNetwork = vi.fn()

const checksum = "a".repeat(64)
const fixture = {
  apiVersion: 1,
  id: "ipc-fixture",
  name: "合成报告",
  version: "1.0.0",
  pigclaudeVersion: "*",
  entry: "index.mjs",
  permissions: ["network", "secrets", "composer-insert"],
  networkDomains: ["fixture.example.com"],
  commands: [{ id: "compose", title: "插入合成文字", slash: "/compose" }],
  settings: [{ key: "password", label: "密钥", type: "secret" }],
  tools: [{ name: "identify", description: "返回标记", inputSchema: { type: "object" } }],
  toolResultTemplates: [{ tool: "identify", template: "结果：{{summary}}" }],
}

beforeEach(async () => {
  native.handlers.clear()
  native.showOpenDialog.mockReset()
  directory = await mkdtemp(join(tmpdir(), "capability-plugin-ipc-"))
  manager = new CapabilityPluginManager({
    root: directory,
    appVersion: "0.0.5",
    membership: () => "active",
    developerMode: () => false,
    stopInstances: async () => undefined,
    readArchive: async () =>
      new Map([
        [capabilityPluginManifestFile, Buffer.from(JSON.stringify(fixture))],
        [fixture.entry, Buffer.from('export default () => "fixture";')],
      ]),
  })
  sandboxInvoke.mockReset()
  pluginNetwork.mockReset()
  pluginNetwork.mockResolvedValue({
    egressId: "system",
    domains: ["fixture.example.com"],
    permits: () => false,
    forward: () => Promise.resolve(Response.error()),
  })
  const secrets = createCapabilityPluginSecrets(directory, {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: () => Buffer.from("opaque"),
    decryptString: () => "synthetic-secret",
  })
  declarations = new CapabilityPluginDeclarationHost({
    manager,
    settings: new CapabilityPluginSettings(directory, secrets),
    runtime: { pluginNetwork },
    sandbox: { invoke: sandboxInvoke },
    active: () => true,
  })
  registerCapabilityPluginIpc({
    getManager: () => manager,
    getDeclarations: () => declarations,
    isTrusted: (event) => event === owner || event === nextPage,
  })
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function invoke(command: string, event: IpcMainInvokeEvent, ...args: unknown[]) {
  const handle = native.handlers.get(capabilityPluginChannelPrefix + command)
  if (!handle) throw new Error("缺少管理命令 " + command)
  return handle(event, ...args)
}

it("拒绝外部 frame 和无效归档来源，生产模式下只能用原生选择归档", async () => {
  await expect(invoke("list", stray)).rejects.toThrow("UNTRUSTED_PLUGIN_REQUEST")
  await expect(invoke("status", owner)).resolves.toEqual({ developerMode: false })
  await expect(invoke("pick", owner, "directory")).rejects.toThrow("PLUGIN_DEVELOPER_MODE_REQUIRED")
  expect(native.showOpenDialog).not.toHaveBeenCalled()
  const path = join(directory, "fixture.zip")
  native.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] })
  await expect(invoke("pick", owner, "archive")).resolves.toBe(path)
  expect(native.showOpenDialog).toHaveBeenCalledExactlyOnceWith(
    native.window,
    expect.objectContaining({ properties: ["openFile"] }),
  )
  await expect(invoke("prepare", owner, { kind: "archive", path })).rejects.toThrow(
    "PLUGIN_ARCHIVE_SHA256_INVALID",
  )
  manager = null
  await expect(invoke("list", owner)).rejects.toThrow("PLUGIN_MANAGER_UNAVAILABLE")
})

it("确认与准备绑定同一个受信 frame，安装只采用披露里的域名", async () => {
  const path = join(directory, "fixture.zip")
  const pending = (await invoke("prepare", owner, {
    kind: "archive",
    path,
    sha256: checksum,
  })) as CapabilityPluginInstallDisclosure
  expect(await invoke("list", owner)).toEqual([])
  expect(pending.manifest.networkDomains).toEqual(["fixture.example.com"])
  await expect(invoke("confirm", nextPage, pending.confirmationId)).rejects.toThrow(
    "PLUGIN_CONFIRMATION_INVALID",
  )
  await expect(
    invoke("confirm", owner, pending.confirmationId, ["other.example.com"]),
  ).resolves.toMatchObject({
    enabled: true,
    approvedDomains: ["fixture.example.com"],
  })
  await expect(invoke("set-enabled", owner, fixture.id, "false")).rejects.toThrow(
    "PLUGIN_SOURCE_INVALID",
  )
  await expect(invoke("set-enabled", owner, fixture.id, false)).resolves.toMatchObject({
    enabled: false,
  })
  await invoke("uninstall", owner, fixture.id, true)
  expect(await invoke("list", owner)).toEqual([])
})

it("工具询问偏好只通过可信设置窗口修改，并进入后续会话快照", async () => {
  const pending = (await invoke("prepare", owner, {
    kind: "archive",
    path: join(directory, "fixture.zip"),
    sha256: checksum,
  })) as CapabilityPluginInstallDisclosure
  await expect(invoke("confirm", owner, pending.confirmationId)).resolves.toMatchObject({
    toolApproval: "always_ask",
  })
  await expect(invoke("set-tool-approval", stray, fixture.id, "follow_session")).rejects.toThrow(
    "UNTRUSTED_PLUGIN_REQUEST",
  )
  await expect(invoke("set-tool-approval", owner, fixture.id, "always_allow")).rejects.toThrow(
    "PLUGIN_TOOL_APPROVAL_INVALID",
  )
  await expect(
    invoke("set-tool-approval", owner, fixture.id, "follow_session"),
  ).resolves.toMatchObject({
    toolApproval: "follow_session",
  })
  await expect(manager?.snapshotEnabled()).resolves.toMatchObject([
    { toolApproval: "follow_session" },
  ])
})

it("只发布启用版本的贡献，命令与设置受信且停用后撤销", async () => {
  const prepared = (await invoke("prepare", owner, {
    kind: "archive",
    path: join(directory, "fixture.zip"),
    sha256: checksum,
  })) as CapabilityPluginInstallDisclosure
  const installed = (await invoke(
    "confirm",
    owner,
    prepared.confirmationId,
  )) as InstalledCapabilityPlugin
  await invoke("set-enabled", owner, fixture.id, true)
  const plugin = { pluginId: fixture.id, revision: installed.revision }

  await expect(invoke("list-declarations", owner)).resolves.toEqual([
    {
      ...plugin,
      commands: fixture.commands,
      toolResults: [
        {
          toolName: capabilityPluginToolName(fixture.id, "identify"),
          template: "结果：{{summary}}",
        },
      ],
    },
  ])
  await expect(invoke("run-command", stray, plugin, "compose")).rejects.toThrow(
    "UNTRUSTED_PLUGIN_REQUEST",
  )
  await expect(invoke("run-command", owner, plugin, "identify")).rejects.toThrow(
    "PLUGIN_DECLARATION_UNAVAILABLE",
  )
  expect(sandboxInvoke).not.toHaveBeenCalled()
  sandboxInvoke.mockResolvedValue({ insertText: "合成草稿", ignored: "隐藏结果" })
  await expect(invoke("run-command", owner, plugin, "compose")).resolves.toEqual({
    insertText: "合成草稿",
  })
  expect(pluginNetwork).toHaveBeenCalledWith(null, {
    declaredDomains: fixture.networkDomains,
    approvedDomains: fixture.networkDomains,
  })
  expect(sandboxInvoke).toHaveBeenCalledWith(
    expect.objectContaining({ pluginId: fixture.id, egressId: "system" }),
    { operation: "command:compose", input: null },
  )
  await expect(
    invoke("set-setting", owner, plugin, "password", "synthetic-secret"),
  ).resolves.toEqual({
    values: {},
    configuredSecrets: ["password"],
  })

  let signalStarted = () => {}
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  let finish: (value: { insertText: string }) => void = () => {}
  const response = new Promise<{ insertText: string }>((resolve) => {
    finish = resolve
  })
  sandboxInvoke.mockImplementationOnce(() => {
    signalStarted()
    return response
  })
  const pending = expect(invoke("run-command", owner, plugin, "compose")).rejects.toThrow(
    "PLUGIN_DECLARATION_UNAVAILABLE",
  )
  await started
  await invoke("set-enabled", owner, fixture.id, false)
  finish({ insertText: "已停用命令不再返回文字" })
  await pending
  await expect(invoke("list-declarations", owner)).resolves.toEqual([])
  await expect(invoke("read-settings", owner, plugin)).rejects.toThrow(
    "PLUGIN_DECLARATION_UNAVAILABLE",
  )
})
