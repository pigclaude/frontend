// 离线验证官方目录的原始字节，并以纯函数更新本机的防回滚和签名钥匙吊销状态。
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto"
import { z } from "zod"
import type { PluginMarketplaceCatalog } from "./plugin-marketplace-catalog"
import {
  parsePluginMarketplaceCatalog,
  pluginMarketplaceCatalogBytesLimit,
} from "./plugin-marketplace-parser"

// pigclaude/plugs@32010ed 发布的当前和备用 Ed25519 SPKI 公钥。
const publicKeys = [
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAKJgwVl0uk7/lEUuxzyL7zOVmrUfQ14vWth0OOLzHNKQ=\n-----END PUBLIC KEY-----",
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAFm6/TTOCkbR8sQYiZVIQmf9FBqPe6jHJP8hC5IVroaA=\n-----END PUBLIC KEY-----",
] as const

const invalidSignature = "PLUGIN_MARKETPLACE_OFFICIAL_SIGNATURE_INVALID"
const untrustedKey = "PLUGIN_MARKETPLACE_OFFICIAL_KEY_UNTRUSTED"
const revokedKey = "PLUGIN_MARKETPLACE_OFFICIAL_KEY_REVOKED"
const invalidCatalog = "PLUGIN_MARKETPLACE_OFFICIAL_CATALOG_INVALID"
const invalidTrust = "PLUGIN_MARKETPLACE_OFFICIAL_TRUST_INVALID"

const decoder = new TextDecoder("utf-8", { fatal: true })
const pluginName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
const repo = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/)
const commit = z.string().regex(/^[0-9a-f]{40}$/)
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const keyId = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const serialNumber = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const nonempty = z.string().refine((value) => value.trim().length > 0)
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  .refine((value) => {
    const time = Date.parse(value)
    return Number.isFinite(time) && new Date(time).toISOString() === value.slice(0, -1) + ".000Z"
  })

const revocation = z.object({
  name: pluginName,
  repo,
  sha: commit.optional(),
  reason: nonempty,
  revokedAt: timestamp,
})
const metadata = z
  .object({
    formatVersion: z.literal(1),
    serial: serialNumber,
    issuedAt: timestamp,
    expiresAt: timestamp,
    revoked: z.array(revocation),
    revokedKeys: z.array(keyId),
  })
  .refine(({ issuedAt, expiresAt }) => issuedAt < expiresAt)
const entry = z.object({
  name: pluginName,
  description: nonempty,
  version: nonempty,
  publisherType: z.unknown().optional(),
  category: z.unknown().optional(),
  source: z.object({ source: z.literal("github"), repo, sha: commit }),
  pigclaude: z.object({
    kind: z.enum(["capability", "claude-code"]),
    sha256,
    permissions: z.array(nonempty),
    domains: z.array(nonempty),
    review: z.object({ status: z.literal("reviewed"), reviewedAt: timestamp }),
  }),
})
const displayCategory = z.string().trim().min(1).max(64)
const officialCatalog = z.object({
  name: pluginName,
  owner: z.object({ name: nonempty }),
  metadata: z.object({ pigclaude: metadata }),
  plugins: z.array(entry),
})
const detachedSignature = z.object({
  algorithm: z.literal("ed25519"),
  keyId,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
})
const trustState = z.object({
  schemaVersion: z.literal(1),
  keyFloors: z.record(keyId, z.object({ serial: serialNumber, digest: sha256 })),
  revokedKeys: z.array(keyId),
})

/** 记录各可信签名钥匙的最高已接受序号与原始目录摘要，吊销的钥匙不能恢复。 */
export type OfficialMarketplaceTrustState = Readonly<{
  schemaVersion: 1
  keyFloors: Readonly<Record<string, Readonly<{ serial: number; digest: string }>>>
  revokedKeys: readonly string[]
}>

/** 官方目录吊销一个市场插件或它的单独 GitHub 提交。repo 已规范为小写。 */
export type OfficialMarketplaceRevocation = Readonly<{
  name: string
  repo: string
  sha?: string
  reason: string
  revokedAt: string
}>

/** 已验签的目录及安装和吊销核验所需的元数据；过期时间由调用方使用。 */
export type OfficialPluginMarketplaceCatalog = Readonly<{
  catalog: PluginMarketplaceCatalog
  serial: number
  issuedAt: string
  expiresAt: string
  digest: string
  signer: string
  revoked: readonly OfficialMarketplaceRevocation[]
  revokedKeys: readonly string[]
}>

/** 校验本机信任记录的结构，损坏的记录不能被当作首次使用。 */
export function parseOfficialMarketplaceTrustState(value: unknown): OfficialMarketplaceTrustState {
  const parsed = trustState.safeParse(value)
  if (!parsed.success) throw new Error(invalidTrust)
  return parsed.data
}

/** 仅接受可信公钥对原始字节的签名。同序号只接受相同目录，成功才返回新的信任状态。 */
export function verifyOfficialPluginMarketplace(
  catalogBytes: Uint8Array,
  signatureBytes: Uint8Array,
  previous?: OfficialMarketplaceTrustState,
  keys: readonly string[] = publicKeys,
): { verified: OfficialPluginMarketplaceCatalog; trust: OfficialMarketplaceTrustState } {
  if (catalogBytes.byteLength > pluginMarketplaceCatalogBytesLimit) throw new Error(invalidCatalog)
  const bytes = Buffer.from(catalogBytes)
  const prior =
    previous === undefined
      ? { schemaVersion: 1 as const, keyFloors: {}, revokedKeys: [] }
      : parseOfficialMarketplaceTrustState(previous)
  const signature = decodeSignature(signatureBytes)
  const trusted = trustedPublicKeyMap(keys)
  const key = trusted.get(signature.keyId)
  if (key === undefined) throw new Error(untrustedKey)
  if (prior.revokedKeys.includes(signature.keyId)) throw new Error(revokedKey)
  if (!verify(null, bytes, key, signature.bytes)) throw new Error(invalidSignature)

  const verified = verifiedCatalog(bytes, signature.keyId)
  return { verified, trust: nextTrust(verified, prior, trusted) }
}

function decodeSignature(input: Uint8Array): { keyId: string; bytes: Buffer } {
  try {
    const signature = detachedSignature.parse(JSON.parse(decoder.decode(input)) as unknown)
    const bytes = Buffer.from(signature.signature, "base64")
    if (bytes.length !== 64 || bytes.toString("base64") !== signature.signature)
      throw new Error(invalidSignature)
    return { keyId: signature.keyId, bytes }
  } catch {
    throw new Error(invalidSignature)
  }
}

function trustedPublicKeyMap(pems: readonly string[]): ReadonlyMap<string, KeyObject> {
  try {
    return new Map(
      pems.map((pem) => {
        if (
          !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(
            pem.trim(),
          )
        )
          throw new Error(untrustedKey)
        const key = createPublicKey(pem)
        if (key.asymmetricKeyType !== "ed25519") throw new Error(untrustedKey)
        const { x } = key.export({ format: "jwk" })
        if (typeof x !== "string") throw new Error(untrustedKey)
        const raw = Buffer.from(x, "base64url")
        if (raw.length !== 32) throw new Error(untrustedKey)
        return ["sha256:" + digestOf(raw), key]
      }),
    )
  } catch {
    throw new Error(untrustedKey)
  }
}

function verifiedCatalog(bytes: Uint8Array, signer: string): OfficialPluginMarketplaceCatalog {
  try {
    const raw = officialCatalog.parse(JSON.parse(decoder.decode(bytes)) as unknown)
    const { serial, issuedAt, expiresAt, revoked, revokedKeys } = raw.metadata.pigclaude
    const catalog = parsePluginMarketplaceCatalog(bytes)
    if (
      catalog.entries.length !== raw.plugins.length ||
      raw.plugins.some((plugin, index) => {
        const item = catalog.entries[index]
        return (
          !item ||
          item.info.id !== plugin.name ||
          item.info.type !== plugin.pigclaude.kind ||
          item.source.kind !== "github" ||
          item.source.repo !== plugin.source.repo.toLowerCase() ||
          item.source.commit !== plugin.source.sha ||
          item.expectedSha256 !== plugin.pigclaude.sha256
        )
      })
    )
      throw new Error(invalidCatalog)
    return {
      catalog: {
        ...catalog,
        entries: catalog.entries.map((item, index) => {
          const published = raw.plugins[index]
          const publisher = published?.publisherType
          const category = displayCategory.safeParse(published?.category)
          if (publisher !== "official" && publisher !== "community" && !category.success)
            return item
          return {
            ...item,
            officialListing: {
              publisherType: publisher === "community" ? "community" : "official",
              ...(category.success ? { category: category.data } : {}),
            },
          }
        }),
      },
      serial,
      issuedAt,
      expiresAt,
      digest: digestOf(bytes),
      signer,
      revoked: revoked.map(({ repo, sha, ...item }) => ({
        ...item,
        repo: repo.toLowerCase(),
        ...(sha === undefined ? {} : { sha }),
      })),
      revokedKeys,
    }
  } catch {
    throw new Error(invalidCatalog)
  }
}

function nextTrust(
  catalog: OfficialPluginMarketplaceCatalog,
  previous: OfficialMarketplaceTrustState,
  trusted: ReadonlyMap<string, KeyObject>,
): OfficialMarketplaceTrustState {
  const revoked = new Set([...previous.revokedKeys, ...catalog.revokedKeys])
  if (revoked.has(catalog.signer)) throw new Error(revokedKey)
  // 先在候选状态撤下相关钥匙带来的下限，允许备用钥匙完成合法轮换。
  const keyFloors = Object.fromEntries(
    Object.entries(previous.keyFloors).filter(([id]) => trusted.has(id) && !revoked.has(id)),
  )
  const floors = Object.values(keyFloors)
  const highest = floors.reduce((value, floor) => Math.max(value, floor.serial), 0)
  if (catalog.serial < highest) throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_ROLLBACK")
  if (
    catalog.serial === highest &&
    floors.some((floor) => floor.serial === highest && floor.digest !== catalog.digest)
  )
    throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_SERIAL_CONFLICT")
  return {
    schemaVersion: 1,
    keyFloors: {
      ...keyFloors,
      [catalog.signer]: { serial: catalog.serial, digest: catalog.digest },
    },
    revokedKeys: [...revoked].sort(),
  }
}

function digestOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
