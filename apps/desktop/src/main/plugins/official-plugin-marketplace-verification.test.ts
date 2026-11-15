// 用内存生成的测试钥验证目录原始字节、公钥身份和持久防回滚状态。
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { expect, it } from "vitest"
import {
  parseOfficialMarketplaceTrustState,
  verifyOfficialPluginMarketplace,
} from "./official-plugin-marketplace-verification"

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const pem = publicKey.export({ type: "spki", format: "pem" }) as string
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32)
  const keyId = "sha256:" + createHash("sha256").update(raw).digest("hex")
  return {
    pem,
    keyId,
    detach(bytes: Uint8Array): Buffer {
      return Buffer.from(
        JSON.stringify({
          algorithm: "ed25519",
          keyId,
          signature: sign(null, bytes, privateKey).toString("base64"),
        }),
      )
    },
  }
}

const current = signer()
const backup = signer()
const publicKeys = [current.pem, backup.pem]
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const issuedAt = "2020-01-01T00:00:00Z"
const expiresAt = "2020-02-01T00:00:00Z"

function catalog(
  serial: number,
  {
    revokedKeys = [],
    revoked = [],
    plugins = [],
  }: { revokedKeys?: string[]; revoked?: unknown[]; plugins?: unknown[] } = {},
): Buffer {
  return Buffer.from(
    JSON.stringify({
      name: "official-fixture",
      owner: { name: "测试维护者" },
      metadata: {
        pigclaude: { formatVersion: 1, serial, issuedAt, expiresAt, revoked, revokedKeys },
      },
      plugins,
    }) + "\n",
  )
}

it("验签点是目录原始字节；合法的过期目录继续提供安装门禁元数据", () => {
  const bytes = catalog(1)
  const signature = current.detach(bytes)
  const result = verifyOfficialPluginMarketplace(bytes, signature, undefined, publicKeys)
  expect(result).toEqual({
    verified: {
      catalog: { name: "official-fixture", entries: [] },
      serial: 1,
      issuedAt,
      expiresAt,
      digest: digest(bytes),
      signer: current.keyId,
      revoked: [],
      revokedKeys: [],
    },
    trust: {
      schemaVersion: 1,
      keyFloors: { [current.keyId]: { serial: 1, digest: digest(bytes) } },
      revokedKeys: [],
    },
  })
  expect(parseOfficialMarketplaceTrustState(JSON.parse(JSON.stringify(result.trust)))).toEqual(
    result.trust,
  )
  expect(() =>
    verifyOfficialPluginMarketplace(bytes.subarray(0, -1), signature, result.trust, publicKeys),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_SIGNATURE_INVALID")
})

it("两把可信钥匙共享有效序号下限，同序号只能重复使用相同字节", () => {
  const listing = catalog(5)
  const { trust } = verifyOfficialPluginMarketplace(
    listing,
    current.detach(listing),
    undefined,
    publicKeys,
  )
  const switched = verifyOfficialPluginMarketplace(
    listing,
    backup.detach(listing),
    trust,
    publicKeys,
  )
  expect(switched.trust.keyFloors).toEqual({
    [current.keyId]: { serial: 5, digest: digest(listing) },
    [backup.keyId]: { serial: 5, digest: digest(listing) },
  })

  const older = catalog(4)
  expect(() =>
    verifyOfficialPluginMarketplace(older, backup.detach(older), trust, publicKeys),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_ROLLBACK")

  const differentBytes = Buffer.concat([listing, Buffer.from(" ")])
  expect(() =>
    verifyOfficialPluginMarketplace(
      differentBytes,
      backup.detach(differentBytes),
      trust,
      publicKeys,
    ),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_SERIAL_CONFLICT")
  expect(trust.keyFloors).toEqual({ [current.keyId]: { serial: 5, digest: digest(listing) } })
})

it("备用钥匙完成轮换时移除被吊销钥匙的下限，重开后继续拒绝被吊销钥匙", () => {
  const first = catalog(2)
  const backupTrust = verifyOfficialPluginMarketplace(
    first,
    backup.detach(first),
    undefined,
    publicKeys,
  ).trust
  const high = catalog(Number.MAX_SAFE_INTEGER)
  const prior = verifyOfficialPluginMarketplace(
    high,
    current.detach(high),
    backupTrust,
    publicKeys,
  ).trust
  const older = catalog(1, { revokedKeys: [current.keyId] })
  expect(() =>
    verifyOfficialPluginMarketplace(older, backup.detach(older), prior, publicKeys),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_ROLLBACK")
  expect(prior.revokedKeys).toEqual([])

  const rotation = catalog(3, { revokedKeys: [current.keyId] })
  const accepted = verifyOfficialPluginMarketplace(
    rotation,
    backup.detach(rotation),
    prior,
    publicKeys,
  )
  expect(accepted.verified.revokedKeys).toEqual([current.keyId])
  expect(accepted.trust).toEqual({
    schemaVersion: 1,
    keyFloors: { [backup.keyId]: { serial: 3, digest: digest(rotation) } },
    revokedKeys: [current.keyId],
  })
  const reopened = parseOfficialMarketplaceTrustState(JSON.parse(JSON.stringify(accepted.trust)))
  const latest = catalog(4)
  const next = verifyOfficialPluginMarketplace(latest, backup.detach(latest), reopened, publicKeys)
  expect(next.verified.revokedKeys).toEqual([])
  expect(next.trust.revokedKeys).toEqual([current.keyId])
  expect(() =>
    verifyOfficialPluginMarketplace(latest, current.detach(latest), next.trust, publicKeys),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_KEY_REVOKED")
})

it("拒绝未知钥匙和吊销自己的目录", () => {
  const unknown = signer()
  const bytes = catalog(1)
  expect(() =>
    verifyOfficialPluginMarketplace(bytes, unknown.detach(bytes), undefined, publicKeys),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_KEY_UNTRUSTED")

  const revoked = catalog(2, { revokedKeys: [current.keyId] })
  expect(() =>
    verifyOfficialPluginMarketplace(revoked, current.detach(revoked), undefined, publicKeys),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_KEY_REVOKED")
})

const pinned = {
  name: "fixture-plugin",
  description: "本机合成包",
  version: "1.0.0",
  source: { source: "github", repo: "Fixture/Plugin", sha: "a".repeat(40), ref: "main" },
  pigclaude: {
    kind: "capability",
    sha256: "b".repeat(64),
    permissions: ["storage"],
    domains: [],
    review: { status: "reviewed", reviewedAt: issuedAt },
  },
}

it("返回全量固定 GitHub 条目和规范化的提交/仓库吊销", () => {
  const revoked = [
    {
      name: pinned.name,
      repo: pinned.source.repo,
      sha: pinned.source.sha,
      reason: "合成提交吊销",
      revokedAt: issuedAt,
    },
    {
      name: "other-plugin",
      repo: "Fixture/Other",
      reason: "合成仓库吊销",
      revokedAt: issuedAt,
    },
  ]
  const bytes = catalog(1, { plugins: [pinned], revoked })
  const { verified } = verifyOfficialPluginMarketplace(
    bytes,
    current.detach(bytes),
    undefined,
    publicKeys,
  )
  expect(verified.catalog.entries).toEqual([
    {
      info: {
        id: pinned.name,
        name: pinned.name,
        type: "capability",
        description: pinned.description,
        version: pinned.version,
        author: null,
        permissions: ["storage"],
        domains: [],
      },
      source: { kind: "github", repo: "fixture/plugin", commit: pinned.source.sha },
      expectedSha256: pinned.pigclaude.sha256,
    },
  ])
  expect(verified.revoked).toEqual([
    { ...revoked[0], repo: "fixture/plugin" },
    { ...revoked[1], repo: "fixture/other" },
  ])
})

it.each([
  ["不支持的来源", { name: "unexpected", source: { source: "npm" } }],
  [
    "未锁定提交",
    {
      ...pinned,
      name: "unpinned",
      source: { source: "github", repo: "Fixture/Plugin", ref: "main" },
    },
  ],
  [
    "未锁定摘要",
    { ...pinned, name: "unhashed", pigclaude: { ...pinned.pigclaude, sha256: undefined } },
  ],
  [
    "缺少正式审核",
    { ...pinned, name: "unreviewed", pigclaude: { ...pinned.pigclaude, review: undefined } },
  ],
])("整份拒绝包含%s的官方目录", (_reason, invalid) => {
  const bytes = catalog(1, { plugins: [pinned, invalid] })
  expect(() =>
    verifyOfficialPluginMarketplace(bytes, current.detach(bytes), undefined, publicKeys),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_CATALOG_INVALID")
})

it("损坏的持久信任状态不能降级成首次接收", () => {
  expect(() =>
    parseOfficialMarketplaceTrustState({
      schemaVersion: 1,
      keyFloors: { [current.keyId]: { serial: 5, digest: "bad-digest" } },
      revokedKeys: [],
    }),
  ).toThrow("PLUGIN_MARKETPLACE_OFFICIAL_TRUST_INVALID")
})
