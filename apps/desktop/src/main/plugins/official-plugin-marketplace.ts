// 维护只属于官方市场的签名缓存和一次安装确认的实时授权。

import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { MembershipState } from "@pigclaude/contracts/membership"
import { z } from "zod"
import { atomicJson, readJson } from "./capability-plugin-records"
import {
  officialPluginMarketplaceRepository,
  type downloadOfficialPluginMarketplace,
} from "./official-plugin-marketplace-download"
import type {
  OfficialMarketplaceTrustState,
  OfficialPluginMarketplaceCatalog,
  parseOfficialMarketplaceTrustState,
  verifyOfficialPluginMarketplace,
} from "./official-plugin-marketplace-verification"
import { pluginMarketplaceCatalogBytesLimit } from "./plugin-marketplace-parser"
import type { PluginMarketplaceResolvedEntry } from "./plugin-marketplace-sources"

/** 由主进程分配的固定官方市场 ID。 */
export const officialPluginMarketplaceId = "pigclaude-official"

/** 官方缓存仅使用受信公开下载和验证入口。 */
export type OfficialPluginMarketplaceOptions = {
  path: string
  active: () => boolean
  download: typeof downloadOfficialPluginMarketplace
  verify: typeof verifyOfficialPluginMarketplace
  parseTrust: typeof parseOfficialMarketplaceTrustState
  now?: () => number
}

/** 主进程缓存的已验签目录；可供浏览过期的目录。 */
export type OfficialPluginMarketplaceSnapshot = {
  commit: string
  refreshedAt: string
  verified: OfficialPluginMarketplaceCatalog
}

type Published = { view: OfficialPluginMarketplaceSnapshot; revision: symbol }
type State = {
  published: Published | null
  trust: OfficialMarketplaceTrustState | undefined
  cacheError?: string
}
type VerifiedState = { published: Published; trust: OfficialMarketplaceTrustState }

const unavailable = "PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE"
const invalidCache = "PLUGIN_MARKETPLACE_OFFICIAL_CACHE_INVALID"
const changed = "PLUGIN_MARKETPLACE_SOURCE_CHANGED"
const verificationErrors = [
  "PLUGIN_MARKETPLACE_OFFICIAL_SIGNATURE_INVALID",
  "PLUGIN_MARKETPLACE_OFFICIAL_KEY_UNTRUSTED",
  "PLUGIN_MARKETPLACE_OFFICIAL_KEY_REVOKED",
  "PLUGIN_MARKETPLACE_OFFICIAL_CATALOG_INVALID",
  "PLUGIN_MARKETPLACE_OFFICIAL_TRUST_INVALID",
  "PLUGIN_MARKETPLACE_OFFICIAL_ROLLBACK",
  "PLUGIN_MARKETPLACE_OFFICIAL_SERIAL_CONFLICT",
] as const
const knownErrors = new Set<string>([...verificationErrors, "MEMBERSHIP_REQUIRED", changed])
const cacheTrust = z.object({ schemaVersion: z.literal(1), trust: z.unknown() })
const cachePayload = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  refreshedAt: z.iso.datetime(),
  catalog: base64(pluginMarketplaceCatalogBytesLimit),
  signature: base64(4096),
})
type CachePayload = z.output<typeof cachePayload>

/** 原子持久官方目录和防回滚状态，在安装前重新确认会员、时间及目录版本。 */
export class OfficialPluginMarketplace {
  #state: State | undefined
  #reading: Promise<State> | undefined
  #publishing: symbol | undefined
  #writes: Promise<void> = Promise.resolve()
  #membershipEpoch = 0
  readonly #now: () => number

  /** 从本机缓存恢复状态，下载只在显式刷新时进行。 */
  constructor(private readonly options: OfficialPluginMarketplaceOptions) {
    this.#now = options.now ?? Date.now
  }

  /** 读取已通过验签的本机缓存；无缓存返回 null，损坏时报告固定错误。 */
  async get(): Promise<OfficialPluginMarketplaceSnapshot | null> {
    const { published, cacheError } = await this.#read()
    if (cacheError !== undefined) throw new Error(cacheError)
    return published === null ? null : structuredClone(published.view)
  }

  /** 下载并原子发布新的验证状态。 */
  async refresh(): Promise<OfficialPluginMarketplaceSnapshot> {
    const epoch = this.#membershipEpoch
    this.#assertMember(epoch)
    const result = this.#writes.then(() => this.#refresh(epoch))
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** 绑定官方条目和可在写盘前重新校验的授权。 */
  async resolve(entryId: string): Promise<PluginMarketplaceResolvedEntry> {
    const epoch = this.#membershipEpoch
    this.#assertMember(epoch)
    const { published } = await this.#read()
    this.#assertMember(epoch)
    if (!published) throw new Error(unavailable)
    const { view, revision } = published
    const entry = view.verified.catalog.entries.find(({ info }) => info.id === entryId)
    if (!entry) throw new Error("PLUGIN_MARKETPLACE_ENTRY_NOT_FOUND")
    const source = entry.source
    if (source.kind !== "github" || entry.expectedSha256 === null) throw new Error(unavailable)
    const assertCurrent = () => {
      this.#assertMember(epoch)
      if (
        this.#state?.published?.revision !== revision ||
        (this.#publishing !== undefined && this.#publishing !== revision)
      )
        throw new Error(changed)
      if (!(this.#now() < Date.parse(view.verified.expiresAt)))
        throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_EXPIRED")
      if (
        view.verified.revoked.some(
          ({ name, repo, sha }) =>
            name === entry.info.id &&
            repo === source.repo &&
            (sha === undefined || sha === source.commit),
        )
      )
        throw new Error("PLUGIN_MARKETPLACE_OFFICIAL_REVOKED")
    }
    assertCurrent()
    return {
      input: { kind: "github", repo: officialPluginMarketplaceRepository, commit: view.commit },
      entry: structuredClone(entry),
      assertCurrent,
    }
  }

  /** 会员离开有效状态时撤销待发布刷新和待确认安装。 */
  membershipChanged(state: MembershipState): void {
    if (state !== "active") this.#membershipEpoch++
  }

  #assertMember(epoch: number): void {
    if (!this.options.active()) throw new Error("MEMBERSHIP_REQUIRED")
    if (epoch !== this.#membershipEpoch) throw new Error(changed)
  }

  #read(): Promise<State> {
    if (this.#state !== undefined) return Promise.resolve(this.#state)
    return (this.#reading ??= this.#readCache()
      .then((state) => {
        this.#state = state
        return state
      })
      .finally(() => {
        this.#reading = undefined
      }))
  }

  async #readCache(): Promise<State> {
    let stored: unknown
    let trust: OfficialMarketplaceTrustState
    try {
      stored = await readJson(this.options.path)
      if (stored === undefined) return { published: null, trust: undefined }
      trust = this.options.parseTrust(cacheTrust.parse(stored).trust)
    } catch (error) {
      throw fixedError(error, invalidCache)
    }
    try {
      return this.#verifiedState(cachePayload.parse(stored), trust, null)
    } catch (error) {
      // 目录字节损坏后仍沿用已保存的信任状态，后续刷新不能回退。
      return { published: null, trust, cacheError: fixedError(error, invalidCache).message }
    }
  }

  async #refresh(epoch: number): Promise<OfficialPluginMarketplaceSnapshot> {
    this.#assertMember(epoch)
    const previous = await this.#read()
    this.#assertMember(epoch)
    let payload: CachePayload
    try {
      const download = await this.options.download()
      payload = cachePayload.parse({
        commit: download.commit,
        catalog: download.catalog.toString("base64"),
        signature: download.signature.toString("base64"),
        refreshedAt: new Date(this.#now()).toISOString(),
      })
    } catch {
      throw new Error(unavailable)
    }
    this.#assertMember(epoch)
    let next: VerifiedState
    try {
      next = this.#verifiedState(payload, previous.trust, previous.published)
    } catch (error) {
      throw fixedError(error, unavailable)
    }
    try {
      await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 })
      await atomicJson(
        this.options.path,
        { schemaVersion: 1, ...payload, trust: next.trust },
        () => {
          this.#assertMember(epoch)
          this.#publishing = next.published.revision
        },
      )
      this.#state = next
    } catch (error) {
      throw fixedError(error, invalidCache)
    } finally {
      this.#publishing = undefined
    }
    return structuredClone(next.published.view)
  }

  #verifiedState(
    payload: CachePayload,
    previousTrust: OfficialMarketplaceTrustState | undefined,
    previous: Published | null,
  ): VerifiedState {
    const { commit, refreshedAt, catalog, signature } = payload
    const result = this.options.verify(
      Buffer.from(catalog, "base64"),
      Buffer.from(signature, "base64"),
      previousTrust,
    )
    const verified = structuredClone(result.verified)
    const revision =
      previous !== null &&
      previous.view.commit === commit &&
      previous.view.verified.digest === verified.digest &&
      previous.view.verified.signer === verified.signer
        ? previous.revision
        : Symbol()
    return {
      published: { revision, view: { commit, refreshedAt, verified } },
      trust: structuredClone(result.trust),
    }
  }
}

function base64(maxBytes: number) {
  return z
    .base64()
    .min(1)
    .max(Math.ceil(maxBytes / 3) * 4)
    .refine((encoded) => {
      const bytes = Buffer.from(encoded, "base64")
      return bytes.length <= maxBytes && bytes.toString("base64") === encoded
    })
}

function fixedError(error: unknown, fallback: string): Error {
  return new Error(
    error instanceof Error && knownErrors.has(error.message) ? error.message : fallback,
  )
}
