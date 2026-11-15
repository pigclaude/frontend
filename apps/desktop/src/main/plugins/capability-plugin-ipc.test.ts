// 通过真实管理器验证管理 IPC 的受信来源、原生来源选择和 frame 绑定确认。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { CapabilityPluginInstallDisclosure } from "../../capability-plugin-contract"
import {
  capabilityPluginChannelPrefix,
  capabilityPluginManifestFile,
} from "../../capability-plugin-contract"
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

const checksum = "a".repeat(64)
const fixture = {
  apiVersion: 1,
  id: "ipc-fixture",
  name: "合成报告",
  version: "1.0.0",
  pigclaudeVersion: "*",
  entry: "index.mjs",
  permissions: ["network"],
  networkDomains: ["fixture.example.com"],
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
  registerCapabilityPluginIpc({
    getManager: () => manager,
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
