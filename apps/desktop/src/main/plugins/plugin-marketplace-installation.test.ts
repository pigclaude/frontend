// 用两种已校验的合成包覆盖市场披露、扩权确认和更新失败时的旧版本。

import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import {
  capabilityPluginManifestFile,
  type CapabilityPluginPermission,
} from "../../capability-plugin-contract"
import { CapabilityPluginManager } from "./capability-plugin-manager"
import { pluginBundleFilesDigest, validateDesktopPluginBundle } from "./desktop-plugin-bundle"
import type { PluginMarketplaceInstallRequest } from "./desktop-plugin-installation"

const id = "market-capability-fixture"
const devPlugin = "market-claude-fixture"
const sourceId = "fixture-source"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-marketplace-install-"))
  roots.push(root)
  const stopInstances = vi.fn<(pluginId?: string) => Promise<void>>().mockResolvedValue(undefined)
  const manager = new CapabilityPluginManager({
    root,
    appVersion: "0.0.5",
    membership: () => "active",
    developerMode: () => false,
    readArchive: async () => new Map(),
    stopInstances,
  })
  let available = true
  const assertCurrent = () => {
    if (!available) throw new Error("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  }
  return {
    root,
    manager,
    stopInstances,
    assertCurrent,
    setAvailable(value: boolean) {
      available = value
    },
  }
}

function fromFiles(
  files: ReadonlyMap<string, Buffer>,
  pluginId: string,
  assertCurrent: () => void,
): PluginMarketplaceInstallRequest {
  return {
    bundle: validateDesktopPluginBundle(files, "0.0.5", pluginId),
    provenance: {
      sourceId,
      entryId: pluginId,
      digest: pluginBundleFilesDigest(files),
      archiveSha256: "b".repeat(64),
      repo: "fixture/repo",
      commit: "a".repeat(40),
    },
    assertCurrent,
  }
}

function capability(
  version: string,
  assertCurrent: () => void,
  permissions: CapabilityPluginPermission[] = ["storage"],
  networkDomains: string[] = [],
): PluginMarketplaceInstallRequest {
  const module = "entry.mjs"
  const manifest = {
    id,
    name: "合成市场能力插件",
    version,
    apiVersion: 1,
    pigclaudeVersion: "*",
    entry: module,
    permissions,
    networkDomains,
    commands: [{ id: "check", title: "查看合成版本" }],
  }
  return fromFiles(
    new Map([
      [capabilityPluginManifestFile, Buffer.from(JSON.stringify(manifest))],
      [module, Buffer.from(`export default () => "${version}"`)],
    ]),
    id,
    assertCurrent,
  )
}

it("只用实际包计算增权，正常更新保留批准偏好并切换到新修订", async () => {
  const f = await fixture()
  const owner = {}
  const first = capability("1.0.0", f.assertCurrent)
  const prepared = await f.manager.prepareMarketplaceInstall(first, owner)
  await expect(f.manager.confirm(prepared.confirmationId, {})).rejects.toThrow(
    "PLUGIN_CONFIRMATION_INVALID",
  )
  const installed = await f.manager.confirm(prepared.confirmationId, owner)
  await f.manager.setToolApproval(id, "follow_session")
  await expect(f.manager.prepareMarketplaceUpdate(first, owner)).resolves.toEqual({
    kind: "unchanged",
  })

  const samePermissions = capability("1.1.0", f.assertCurrent)
  await expect(f.manager.prepareMarketplaceUpdate(samePermissions, owner)).resolves.toEqual({
    kind: "updated",
  })
  await expect(f.manager.canInvoke(id, installed.revision)).resolves.toBe(false)
  await expect(f.manager.snapshotEnabled()).resolves.toMatchObject([
    { manifest: { version: "1.1.0" }, toolApproval: "follow_session" },
  ])
  const [updated] = await f.manager.snapshotEnabled()
  if (!updated) throw new Error("缺少新修订")
  await expect(
    f.manager.commandSnapshot({ pluginId: id, revision: updated.revision }, "check"),
  ).resolves.toMatchObject({ modules: { "entry.mjs": 'export default () => "1.1.0"' } })

  const larger = capability(
    "2.0.0",
    f.assertCurrent,
    ["storage", "network", "workspace-read"],
    ["docs.example.org"],
  )
  const request = await f.manager.prepareMarketplaceUpdate(larger, owner)
  if (request.kind !== "review") throw new Error("缺少新增权限披露")
  expect(request.additionalPermissions).toEqual(["network", "workspace-read"])
  expect(request.additionalDomains).toEqual(["docs.example.org"])
  await expect(f.manager.snapshotEnabled()).resolves.toMatchObject([{ revision: updated.revision }])
  f.setAvailable(false)
  await expect(f.manager.confirm(request.disclosure.confirmationId, owner)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_SOURCE_CHANGED",
  )
  f.setAvailable(true)
  const retry = await f.manager.prepareMarketplaceUpdate(larger, owner)
  if (retry.kind !== "review") throw new Error("缺少重试披露")
  await f.manager.confirm(retry.disclosure.confirmationId, owner)
  const provenance = await f.manager.marketplaceInstallations()
  expect(provenance.get(id)).toEqual(larger.provenance)
  await expect(f.manager.snapshotEnabled()).resolves.toMatchObject([
    {
      manifest: { version: "2.0.0" },
      approvedDomains: ["docs.example.org"],
      toolApproval: "follow_session",
    },
  ])
  await expect(readdir(join(f.root, "installed", id, "revisions"))).resolves.toHaveLength(1)
})

it("发布前市场撤销，旧模块仍可调用且未发布的新目录可清理", async () => {
  const f = await fixture()
  const owner = {}
  const prepared = await f.manager.prepareMarketplaceInstall(
    capability("1.0.0", f.assertCurrent),
    owner,
  )
  const installed = await f.manager.confirm(prepared.confirmationId, owner)
  f.stopInstances.mockImplementationOnce(async () => {
    f.setAvailable(false)
  })
  await expect(
    f.manager.prepareMarketplaceUpdate(capability("1.1.0", f.assertCurrent), owner),
  ).rejects.toThrow("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  await expect(f.manager.canInvoke(id, installed.revision)).resolves.toBe(true)
  await expect(f.manager.snapshotEnabled()).resolves.toMatchObject([
    { revision: installed.revision, manifest: { version: "1.0.0" } },
  ])
  await expect(readdir(join(f.root, "installed", id, "revisions"))).resolves.toEqual([])
})

it("市场安装 Claude Code 包并在手动更新后加载新的合成副本", async () => {
  const f = await fixture()
  const owner = {}
  const file = "commands/read.md"
  const packageRequest = (text: string) =>
    fromFiles(new Map([[file, Buffer.from(text)]]), devPlugin, f.assertCurrent)
  const prepared = await f.manager.prepareMarketplaceInstall(packageRequest("旧正文"), owner)
  expect(prepared.type).toBe("claude-code")
  await f.manager.confirm(prepared.confirmationId, owner)
  await expect(
    f.manager.prepareMarketplaceUpdate(packageRequest("新正文"), owner),
  ).resolves.toEqual({
    kind: "updated",
  })
  const session = join(f.root, "session")
  await mkdir(session)
  await expect(f.manager.stageClaudeCodePlugins(session)).resolves.toEqual([
    join(session, devPlugin),
  ])
  await expect(readFile(join(session, devPlugin, file), "utf8")).resolves.toBe("新正文")
})

it("同名 skill 增加 allowed-tools 后需要重新确认", async () => {
  const f = await fixture()
  const owner = {}
  const packageRequest = (tools: string[]) =>
    fromFiles(
      new Map([
        [
          "skills/read/SKILL.md",
          Buffer.from(
            [
              "---",
              "name: read",
              "allowed-tools:",
              ...tools.map((tool) => "  - " + tool),
              "---",
              "合成说明。",
            ].join("\n"),
          ),
        ],
      ]),
      devPlugin,
      f.assertCurrent,
    )
  const disclosure = await f.manager.prepareMarketplaceInstall(packageRequest(["Read"]), owner)
  await f.manager.confirm(disclosure.confirmationId, owner)
  await expect(
    f.manager.prepareMarketplaceUpdate(packageRequest(["Read", "Grep"]), owner),
  ).resolves.toMatchObject({
    kind: "review",
    additionalPermissions: ["skill-allowed-tools:" + devPlugin + ":read"],
    additionalDomains: [],
  })
})
