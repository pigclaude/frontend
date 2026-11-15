// 通过实际市场和安装管理器验证 IPC 发送方、包身份及确认经过的窗口。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import { expect, it, vi } from "vitest"
import { capabilityPluginChannelPrefix } from "../../capability-plugin-contract"
import {
  pluginMarketplaceChannelPrefix,
  type PluginMarketplaceSourceInput,
} from "../../plugin-marketplace-contract"
import { registerCapabilityPluginIpc } from "./capability-plugin-ipc"
import { CapabilityPluginManager } from "./capability-plugin-manager"
import { PluginMarketplace } from "./plugin-marketplace"
import { registerPluginMarketplaceIpc } from "./plugin-marketplace-ipc"
import { normalizePluginMarketplaceSource } from "./plugin-marketplace-source"
import { PluginMarketplaceSources } from "./plugin-marketplace-sources"
import { PluginMarketplaceThirdParty } from "./plugin-marketplace-third-party"

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
const handlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock("electron", () => ({
  BrowserWindow: {},
  dialog: {},
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

const owner = { senderFrame: {} } as IpcMainInvokeEvent
const another = { senderFrame: {} } as IpcMainInvokeEvent
const stray = { senderFrame: {} } as IpcMainInvokeEvent
const entryId = "ipc-market-sample"
const source = {
  kind: "github",
  repo: "fixture/market",
  commit: "a".repeat(40),
} satisfies PluginMarketplaceSourceInput
const nextCommit = "e".repeat(40)

function invoke(prefix: string, action: string, event: IpcMainInvokeEvent, ...args: unknown[]) {
  const handler = handlers.get(prefix + action)
  if (!handler) throw new Error("测试市场 IPC 未注册")
  return handler(event, ...args)
}

function confirmationId(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    !("confirmationId" in value) ||
    typeof value.confirmationId !== "string"
  )
    throw new Error("缺少市场披露")
  return value.confirmationId
}

function updateConfirmation(value: unknown): string {
  if (!value || typeof value !== "object" || !("disclosure" in value))
    throw new Error("缺少更新确认")
  return confirmationId(value.disclosure)
}

it("市场拒绝无关 frame，确认只接受签发披露的窗口及所选插件", async () => {
  handlers.clear()
  const root = await mkdtemp(join(tmpdir(), "pigclaude-marketplace-ipc-"))
  async function loadPackage(input: PluginMarketplaceSourceInput) {
    if (input.kind !== "github") throw new Error("无效测试来源")
    const refreshed = input.commit === nextCommit
    return {
      files: new Map([
        ["commands/read.md", Buffer.from(refreshed ? "合成新命令" : "合成只读命令")],
      ]),
      digest: (refreshed ? "e" : "b").repeat(64),
      archiveSha256: (refreshed ? "d" : "c").repeat(64),
      repo: input.repo,
      commit: input.commit,
    }
  }
  const load = vi.fn(loadPackage)
  const manager = new CapabilityPluginManager({
    root: join(root, "installed"),
    appVersion: "0.0.5",
    membership: () => "active",
    developerMode: () => false,
    readArchive: async () => new Map(),
    stopInstances: () => undefined,
  })
  const sources = new PluginMarketplaceSources({
    path: join(root, "sources.json"),
    membership: () => "active",
    developerMode: () => false,
    normalize: normalizePluginMarketplaceSource,
    load: async () => ({
      name: "fixture-market",
      entries: [
        {
          info: {
            id: entryId,
            name: "合成市场命令",
            type: "claude-code",
            description: null,
            version: null,
            author: null,
            permissions: [],
            domains: [],
          },
          source: { kind: "relative", path: "plugins/sample" },
          expectedSha256: null,
        },
      ],
    }),
  })
  const isTrusted = (event: IpcMainInvokeEvent) => event === owner || event === another
  const thirdParty = new PluginMarketplaceThirdParty(
    join(root, "third-party.json"),
    () => true,
    () => sources.invalidateRequests(),
  )
  const bridge = new PluginMarketplace(sources, manager, load, "0.0.5", thirdParty)
  registerPluginMarketplaceIpc({ getMarketplace: () => bridge, isTrusted })
  registerCapabilityPluginIpc({ getManager: () => manager, isTrusted })
  const market = (action: string, event: IpcMainInvokeEvent, ...args: unknown[]) =>
    invoke(pluginMarketplaceChannelPrefix, action, event, ...args)
  const confirm = (event: IpcMainInvokeEvent, id: string) =>
    invoke(capabilityPluginChannelPrefix, "confirm", event, id)
  try {
    await expect(market("add", stray, source)).rejects.toThrow("UNTRUSTED_PLUGIN_REQUEST")
    await expect(bridge.list()).resolves.toMatchObject({ thirdPartyEnabled: false, entries: [] })
    await expect(market("add", owner, source)).rejects.toThrow(
      "PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED",
    )
    await expect(market("set-third-party-enabled", stray, true)).rejects.toThrow(
      "UNTRUSTED_PLUGIN_REQUEST",
    )
    await market("set-third-party-enabled", owner, true)
    await market("add", owner, source)
    const id = (await bridge.list()).sources[0]?.id
    if (!id) throw new Error("缺少已添加市场")
    await expect(market("prepare-install", stray, id, entryId)).rejects.toThrow(
      "UNTRUSTED_PLUGIN_REQUEST",
    )
    await expect(market("prepare-install", owner, id, "unselected")).rejects.toThrow(
      "PLUGIN_MARKETPLACE_ENTRY_NOT_FOUND",
    )
    expect(load).not.toHaveBeenCalled()
    let releaseOld = () => {}
    const oldDownload = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    load.mockImplementationOnce(async (input) => {
      await oldDownload
      return loadPackage(input)
    })
    const older = expect(market("prepare-install", owner, id, entryId)).rejects.toThrow(
      "PLUGIN_CONFIRMATION_INVALID",
    )
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    const disclosure = await market("prepare-install", owner, id, entryId)
    releaseOld()
    await older
    const confirmedId = confirmationId(disclosure)
    await expect(confirm(another, confirmedId)).rejects.toThrow("PLUGIN_CONFIRMATION_INVALID")
    await expect(confirm(owner, confirmedId)).resolves.toMatchObject({
      type: "claude-code",
      manifest: { id: entryId },
    })
    expect(load).toHaveBeenCalledTimes(2)
    await expect(bridge.list()).resolves.toMatchObject({
      entries: [{ id: entryId, action: "update", reviewStatus: "unreviewed" }],
    })
    await market("refresh", owner, id, nextCommit)
    await expect(bridge.list()).resolves.toMatchObject({
      sources: [{ id, pin: nextCommit }],
      entries: [{ id: entryId, action: "update" }],
    })
    const change = await market("prepare-update", owner, id, entryId)
    expect(change).toMatchObject({
      kind: "review",
      fileHashChanged: true,
      additionalPermissions: [],
      additionalDomains: [],
    })
    await market("set-third-party-enabled", owner, false)
    await expect(confirm(owner, updateConfirmation(change))).rejects.toThrow(
      "PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED",
    )
    await expect(market("refresh", owner, id)).rejects.toThrow(
      "PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED",
    )
    await expect(bridge.list()).resolves.toMatchObject({
      thirdPartyEnabled: false,
      sources: [{ id }],
      entries: [],
    })
    expect((await manager.marketplaceInstallations()).get(entryId)?.commit).toBe(source.commit)

    await market("set-third-party-enabled", owner, true)
    const approved = await market("prepare-update", owner, id, entryId)
    await confirm(owner, updateConfirmation(approved))
    expect((await manager.marketplaceInstallations()).get(entryId)?.commit).toBe(nextCommit)
    await expect(market("prepare-update", owner, id, entryId)).resolves.toEqual({
      kind: "unchanged",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
