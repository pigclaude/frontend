// 贯穿已验签目录、包字节核验和现有安装管理器，所有网络由合成夹具替代。
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { capabilityPluginManifestFile } from "../../capability-plugin-contract"
import { CapabilityPluginManager } from "./capability-plugin-manager"
import { officialPluginMarketplaceId } from "./official-plugin-marketplace"
import type { OfficialPluginMarketplaceCatalog } from "./official-plugin-marketplace-verification"
import { PluginMarketplace } from "./plugin-marketplace"
import type { PluginMarketplaceCatalogEntry } from "./plugin-marketplace-catalog"
import { PluginMarketplaceSources } from "./plugin-marketplace-sources"
import { PluginMarketplaceThirdParty } from "./plugin-marketplace-third-party"
import { normalizePluginMarketplaceSource } from "./plugin-marketplace-source"

const id = "official-test-capability"
const commit = "e".repeat(40)
const archive = "b".repeat(64)
const repo = "sample/official"
const entry: PluginMarketplaceCatalogEntry = {
  info: {
    id,
    name: "官方合成样例",
    type: "capability",
    author: null,
    description: null,
    version: "1.0.0",
    permissions: [],
    domains: [],
  },
  source: { kind: "github", repo, commit },
  expectedSha256: archive,
}
const fixtureFiles = new Map([
  [
    capabilityPluginManifestFile,
    Buffer.from(
      JSON.stringify({
        id,
        name: entry.info.name,
        version: "1.0.0",
        apiVersion: 1,
        pigclaudeVersion: "*",
        entry: "index.mjs",
      }),
    ),
  ],
  ["index.mjs", Buffer.from('export default () => "official fixture"')],
])

it("官方市场独立于第三方，核对归档摘要，过期保留安装且新吊销会停用旧快照", async () => {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-official-integration-"))
  const stop = vi.fn<(id?: string) => Promise<void>>().mockResolvedValue(undefined)
  const sources = new PluginMarketplaceSources({
    path: join(root, "sources.json"),
    membership: () => "active",
    developerMode: () => false,
    normalize: normalizePluginMarketplaceSource,
    load: async () => ({ name: "未使用的第三方目录", entries: [] }),
  })
  const manager = new CapabilityPluginManager({
    root: join(root, "plugins"),
    appVersion: "0.0.5",
    membership: () => "active",
    developerMode: () => false,
    readArchive: async () => new Map(),
    stopInstances: stop,
  })
  const thirdParty = new PluginMarketplaceThirdParty(
    join(root, "consent.json"),
    () => true,
    () => {},
  )
  const announceRevocation = vi.fn()
  const changed = vi.fn()
  let actualArchive = "f".repeat(64)
  let verified: OfficialPluginMarketplaceCatalog = {
    catalog: { name: officialPluginMarketplaceId, entries: [entry] },
    serial: 1,
    issuedAt: "2020-01-01T00:00:00Z",
    expiresAt: "2050-01-01T00:00:00Z",
    digest: "c".repeat(64),
    signer: "sha256:" + "d".repeat(64),
    revoked: [],
    revokedKeys: [],
  }
  const snapshot = () => ({ commit, refreshedAt: verified.issuedAt, verified })
  const market = new PluginMarketplace(
    sources,
    manager,
    async () => ({
      files: fixtureFiles,
      digest: "a".repeat(64),
      archiveSha256: actualArchive,
      repo,
      commit,
    }),
    "0.0.5",
    thirdParty,
    {
      changed,
      announceRevocation,
      cache: {
        get: async () => snapshot(),
        refresh: async () => snapshot(),
        resolve: async () => {
          if (Date.parse(verified.expiresAt) <= Date.now())
            throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_EXPIRED")
          return {
            input: { kind: "github", repo: "pigclaude/plugs", commit },
            entry,
            assertCurrent() {},
          }
        },
      },
    },
  )
  const owner = {}
  try {
    await expect(market.list()).resolves.toMatchObject({
      thirdPartyEnabled: false,
      sources: [{ id: officialPluginMarketplaceId, kind: "official" }],
      entries: [{ id, reviewStatus: "reviewed", action: "install" }],
    })
    await expect(market.prepareInstall(officialPluginMarketplaceId, id, owner)).rejects.toThrow(
      "PLUGIN_MARKETPLACE_OFFICIAL_PACKAGE_MISMATCH",
    )
    actualArchive = archive
    const disclosure = await market.prepareInstall(officialPluginMarketplaceId, id, owner)
    const installed = await manager.confirm(disclosure.confirmationId, owner)
    expect((await manager.marketplaceInstallations()).get(id)).toMatchObject({
      sourceId: officialPluginMarketplaceId,
      repo,
      commit,
      archiveSha256: archive,
    })

    verified = { ...verified, expiresAt: "2021-01-01T00:00:00Z" }
    await expect(market.list()).resolves.toMatchObject({
      entries: [{ id, action: "blocked", blockedBy: "expired" }],
    })
    await expect(market.prepareUpdate(officialPluginMarketplaceId, id, owner)).rejects.toThrow(
      "PLUGIN_MARKETPLACE_OFFICIAL_EXPIRED",
    )
    await expect(manager.canInvoke(id, installed.revision)).resolves.toBe(true)
    expect(stop).not.toHaveBeenCalled()

    const reason = "合成发布已撤回"
    verified = {
      ...verified,
      serial: 2,
      expiresAt: "2050-01-01T00:00:00Z",
      revoked: [{ name: id, repo, sha: commit, reason, revokedAt: "2020-01-01T00:00:00Z" }],
    }
    await market.refresh(officialPluginMarketplaceId)
    await expect(market.list()).resolves.toMatchObject({
      entries: [{ id, action: "blocked", blockedBy: "revoked" }],
    })
    expect(changed).toHaveBeenCalledOnce()
    expect(announceRevocation).toHaveBeenCalledExactlyOnceWith(entry.info.name, reason)
    expect(stop).toHaveBeenCalledExactlyOnceWith(id)
    await expect(manager.canInvoke(id, installed.revision)).resolves.toBe(false)
    await expect(manager.list()).resolves.toMatchObject([
      { enabled: false, revocationReason: reason },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
