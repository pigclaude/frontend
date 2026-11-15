// 用两种已校验的合成包覆盖市场披露、扩权确认和更新失败时的旧版本。

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import {
  capabilityPluginManifestFile,
  type CapabilityPluginPermission,
} from "../../capability-plugin-contract"
import {
  CapabilityPluginManager,
  type CapabilityPluginManagerOptions,
} from "./capability-plugin-manager"
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
  const options: CapabilityPluginManagerOptions = {
    root,
    appVersion: "0.0.5",
    membership: () => "active",
    developerMode: () => false,
    readArchive: async () => new Map(),
    stopInstances,
  }
  const manager = new CapabilityPluginManager(options)
  let available = true
  const assertCurrent = () => {
    if (!available) throw new Error("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  }
  return {
    root,
    manager,
    reopen: () => new CapabilityPluginManager(options),
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

it("第三方独立归档的摘要变化会询问，包括解包正文一致的情况", async () => {
  const f = await fixture()
  const owner = {}
  const first = capability("1.0.0", f.assertCurrent)
  const prepare = await f.manager.prepareMarketplaceInstall(
    { ...first, provenance: { ...first.provenance, artifactDigest: "a".repeat(64) } },
    owner,
  )
  await f.manager.confirm(prepare.confirmationId, owner)
  const change = await f.manager.prepareMarketplaceUpdate(
    {
      ...first,
      provenance: { ...first.provenance, artifactDigest: "b".repeat(64) },
      requireFileReview: true,
    },
    owner,
  )
  expect(change).toMatchObject({
    kind: "review",
    fileHashChanged: true,
    additionalPermissions: [],
    additionalDomains: [],
  })
  expect((await f.manager.marketplaceInstallations()).get(id)?.artifactDigest).toBe("a".repeat(64))
})

it("只吊销官方来源的同名仓库与提交，停止旧 Worker 并保留插件偏好", async () => {
  const f = await fixture()
  const owner = {}
  const request = capability("1.0.0", f.assertCurrent)
  const prepared = await f.manager.prepareMarketplaceInstall(request, owner)
  const installed = await f.manager.confirm(prepared.confirmationId, owner)
  await f.manager.setToolApproval(id, "follow_session")

  const revoked = { name: id, repo: "Fixture/Repo", sha: "a".repeat(40), reason: "合成撤回" }
  await expect(f.manager.applyMarketplaceRevocations("other-source", [revoked])).resolves.toEqual(
    [],
  )
  await expect(
    f.manager.applyMarketplaceRevocations(sourceId, [
      { ...revoked, name: "other-entry" },
      { ...revoked, repo: "Fixture/Other" },
      { ...revoked, sha: "c".repeat(40) },
    ]),
  ).resolves.toEqual([])
  await expect(f.manager.canInvoke(id, installed.revision)).resolves.toBe(true)

  f.stopInstances.mockRejectedValueOnce(new Error("合成关闭异常"))
  await expect(f.manager.applyMarketplaceRevocations(sourceId, [revoked])).resolves.toEqual([
    { name: id, reason: revoked.reason },
  ])
  expect(f.stopInstances).toHaveBeenCalledExactlyOnceWith(id)
  await expect(f.manager.canInvoke(id, installed.revision)).resolves.toBe(false)
  await expect(f.manager.snapshotEnabled()).resolves.toEqual([])
  await expect(f.manager.setEnabled(id, true)).rejects.toThrow("PLUGIN_MARKETPLACE_PLUGIN_REVOKED")
  await expect(f.manager.list()).resolves.toMatchObject([
    {
      enabled: false,
      revision: installed.revision,
      manifest: { version: "1.0.0" },
      revocationReason: revoked.reason,
      toolApproval: "follow_session",
    },
  ])
  await expect(f.manager.applyMarketplaceRevocations(sourceId, [revoked])).resolves.toEqual([])
  expect(f.stopInstances).toHaveBeenCalledTimes(1)
})

it("已在执行的能力请求在落盘前看到吊销，重开保留记录且新提交保持禁用", async () => {
  const f = await fixture()
  const owner = {}
  const request = capability("1.0.0", f.assertCurrent)
  const review = await f.manager.prepareMarketplaceInstall(request, owner)
  const installed = await f.manager.confirm(review.confirmationId, owner)
  await f.manager.setToolApproval(id, "follow_session")
  const [snapshot] = await f.manager.snapshotEnabled()
  if (!snapshot) throw new Error("缺少已启用模块")
  await mkdir(snapshot.dataDirectory, { recursive: true })
  const settings = join(snapshot.dataDirectory, "settings.json")
  await writeFile(settings, '{"fixture":"retained"}')

  let start = () => {}
  const started = new Promise<void>((resolve) => {
    start = resolve
  })
  let release = () => {}
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const result = f.manager.runCapability(
    id,
    installed.revision,
    new AbortController().signal,
    async (assertCurrent) => {
      start()
      await pending
      assertCurrent()
    },
  )
  const denied = expect(result).rejects.toThrow("PLUGIN_CAPABILITY_DENIED")
  await started
  const revoked = { name: id, repo: "fixture/repo", sha: "a".repeat(40), reason: "合成撤回旧提交" }
  const applied = f.manager.applyMarketplaceRevocations(sourceId, [revoked])
  try {
    await expect(f.manager.canInvoke(id, installed.revision)).resolves.toBe(false)
    expect(f.stopInstances).not.toHaveBeenCalled()
  } finally {
    release()
  }
  await denied
  await expect(applied).resolves.toEqual([{ name: id, reason: revoked.reason }])

  const reopened = f.reopen()
  await expect(reopened.canInvoke(id, installed.revision)).resolves.toBe(false)
  await expect(reopened.setEnabled(id, true)).rejects.toThrow("PLUGIN_MARKETPLACE_PLUGIN_REVOKED")
  // 同一内容可以在新的已签名提交上重新发布，旧提交仍不允许替换。
  await expect(reopened.prepareMarketplaceUpdate(request, owner)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_PLUGIN_REVOKED",
  )
  const next = { ...request, provenance: { ...request.provenance, commit: "b".repeat(40) } }
  await expect(reopened.prepareMarketplaceUpdate(next, owner)).resolves.toEqual({ kind: "updated" })
  const [updated] = await reopened.list()
  expect(updated).toMatchObject({
    enabled: false,
    toolApproval: "follow_session",
    installedAt: installed.installedAt,
  })
  expect(updated?.revision).not.toBe(installed.revision)
  expect(updated?.revocationReason).toBeUndefined()
  await expect(readFile(settings, "utf8")).resolves.toBe('{"fixture":"retained"}')
  await expect(reopened.setEnabled(id, true)).resolves.toMatchObject({ enabled: true })
})

it("仓库级吊销挡住候选和新会话，已经交给 Claude SDK 的合成副本保留", async () => {
  const f = await fixture()
  const owner = {}
  const request = fromFiles(
    new Map([["commands/read.md", Buffer.from("合成 Claude 指令")]]),
    devPlugin,
    f.assertCurrent,
  )
  const review = await f.manager.prepareMarketplaceInstall(request, owner)
  await f.manager.confirm(review.confirmationId, owner)
  const before = join(f.root, "before-revocation")
  await mkdir(before)
  await expect(f.manager.stageClaudeCodePlugins(before)).resolves.toEqual([join(before, devPlugin)])

  const revoked = { name: devPlugin, repo: "Fixture/Repo", reason: "合成仓库撤回" }
  await expect(f.manager.applyMarketplaceRevocations(sourceId, [revoked])).resolves.toEqual([
    { name: devPlugin, reason: revoked.reason },
  ])
  expect(f.stopInstances).not.toHaveBeenCalled()
  await expect(f.manager.stageClaudeCodePlugins(before)).resolves.toEqual([])
  await expect(f.manager.claudeCodePluginCommands()).resolves.toEqual([])
  await expect(readFile(join(before, devPlugin, "commands/read.md"), "utf8")).resolves.toBe(
    "合成 Claude 指令",
  )
  const next = { ...request, provenance: { ...request.provenance, commit: "b".repeat(40) } }
  await expect(f.manager.prepareMarketplaceUpdate(next, owner)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_PLUGIN_REVOKED",
  )
})

it("吊销写盘失败仍撤回权限，清洁更新也需要用户手动启用", async () => {
  const f = await fixture()
  const owner = {}
  const request = capability("1.0.0", f.assertCurrent)
  const review = await f.manager.prepareMarketplaceInstall(request, owner)
  const installed = await f.manager.confirm(review.confirmationId, owner)
  const path = join(f.root, "installed", id, "record.json")
  const previous = await readFile(path)
  f.stopInstances.mockImplementationOnce(async () => {
    await rm(path)
    await mkdir(path)
  })
  const revoked = { name: id, repo: "fixture/repo", sha: "a".repeat(40), reason: "合成撤回" }
  try {
    await expect(f.manager.applyMarketplaceRevocations(sourceId, [revoked])).rejects.toThrow()
  } finally {
    await rm(path, { recursive: true, force: true })
    await writeFile(path, previous)
  }

  await expect(f.manager.applyMarketplaceRevocations(sourceId, [])).resolves.toEqual([])
  await expect(f.manager.canInvoke(id, installed.revision)).resolves.toBe(false)
  await expect(f.manager.setEnabled(id, true)).rejects.toThrow("PLUGIN_MARKETPLACE_PLUGIN_REVOKED")
  await expect(f.manager.list()).resolves.toMatchObject([
    { revision: installed.revision, enabled: false, revocationReason: revoked.reason },
  ])
  const next = { ...request, provenance: { ...request.provenance, commit: "b".repeat(40) } }
  await expect(f.manager.prepareMarketplaceUpdate(next, owner)).resolves.toEqual({
    kind: "updated",
  })
  await expect(f.manager.list()).resolves.toMatchObject([{ enabled: false }])
  expect((await f.manager.list())[0]?.revocationReason).toBeUndefined()
})
