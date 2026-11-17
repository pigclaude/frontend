// 负责市场源的状态、目录缓存和安装确认时重新校验的来源快照。
import { createHash, randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { MembershipState } from "@pigclaude/contracts/membership"
import { z } from "zod"
import type {
  PluginMarketplaceSourceInput,
  PluginMarketplaceSourceView,
} from "../../plugin-marketplace-contract"
import { atomicJson, readJson } from "./capability-plugin-records"
import type {
  PluginMarketplaceCatalog,
  PluginMarketplaceCatalogEntry,
} from "./plugin-marketplace-catalog"

const refreshFailed = "PLUGIN_MARKETPLACE_REFRESH_FAILED"
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const catalogSchema = z.object({
  name: z.string().min(1),
  entries: z.array(
    z.object({
      info: z.object({
        id: z.string().min(1),
        name: z.string(),
        type: z.enum(["capability", "claude-code"]),
        description: z.string().nullable(),
        version: z.string().nullable(),
        author: z.string().nullable(),
        permissions: z.array(z.string()),
        domains: z.array(z.string()),
      }),
      source: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("relative"), path: z.string().min(1) }),
        z.object({ kind: z.literal("github"), repo: z.string(), commit: z.string() }),
        z.object({
          kind: z.literal("github-subdir"),
          repo: z.string(),
          commit: z.string(),
          path: z.string().min(1),
        }),
        z.object({ kind: z.literal("https"), url: z.string(), sha256: digest }),
      ]),
      expectedSha256: digest.nullable(),
    }),
  ),
})
const storedSource = z.object({
  id: z.uuid(),
  revision: z.uuid(),
  input: z.unknown(),
  enabled: z.boolean(),
  catalog: catalogSchema,
  catalogDigest: digest,
  refreshedAt: z.iso.datetime(),
  error: z.literal(refreshFailed).nullable(),
})
const cacheSchema = z.object({ schemaVersion: z.literal(1), sources: z.array(storedSource) })

type SourceRecord = Omit<z.output<typeof storedSource>, "input"> & {
  input: PluginMarketplaceSourceInput
}

type Options = {
  path: string
  membership: () => MembershipState
  developerMode: () => boolean
  normalize: (input: unknown) => PluginMarketplaceSourceInput
  load: (input: PluginMarketplaceSourceInput) => Promise<PluginMarketplaceCatalog>
}

type MarketList = {
  developerMode: boolean
  sources: PluginMarketplaceSourceView[]
  entries: { sourceId: string; entry: PluginMarketplaceCatalogEntry }[]
}

/** 一次准备操作的来源和条目；发布前再确认该来源仍然有效。 */
export type PluginMarketplaceResolvedEntry = {
  input: PluginMarketplaceSourceInput
  entry: PluginMarketplaceCatalogEntry
  assertCurrent(): void
}

/** 串行发布本机市场状态，刷新过程中仍可浏览上次成功的目录。 */
export class PluginMarketplaceSources {
  #records: readonly SourceRecord[] | undefined
  #reading: Promise<readonly SourceRecord[]> | undefined
  #publishing: readonly SourceRecord[] | undefined
  #writes: Promise<void> = Promise.resolve()
  #membershipEpoch = 0
  readonly #listeners = new Set<() => void>()

  /** 连接应用会员、模式和只读来源端口；读取磁盘延后到第一次使用。 */
  constructor(private readonly options: Options) {}

  /** 只读本机快照。停用和当前模式不可用的来源不贡献条目。 */
  async list(): Promise<MarketList> {
    const epoch = this.#captureMembership()
    const records = await this.#read()
    this.#assertMember(epoch)
    const developerMode = this.options.developerMode()
    return {
      developerMode,
      sources: records.map(viewOf),
      entries: records
        .filter((record) => record.enabled && (developerMode || record.input.kind !== "directory"))
        .flatMap((record) =>
          record.catalog.entries.map((entry) => ({
            sourceId: record.id,
            entry: structuredClone(entry),
          })),
        ),
    }
  }

  /** 验证来源及首次目录读取成功后发布，重复来源保持原记录。 */
  async add(value: unknown): Promise<void> {
    const epoch = this.#captureMembership()
    const input = structuredClone(this.options.normalize(value))
    this.#assertSourceMode(input)
    const catalog = await this.#load(input)
    await this.#change(epoch, async (records) => {
      assertUniqueSource(records, input)
      const record = {
        id: randomUUID(),
        revision: randomUUID(),
        input,
        enabled: true,
        catalog,
        catalogDigest: catalogDigest(catalog),
        refreshedAt: new Date().toISOString(),
        error: null,
      }
      await this.#publish([...records, record], epoch, input)
    })
  }

  /** 重读同一来源，可为远程源换固定修订；失败保留旧 pin、目录与成功时间。 */
  async refresh(id: string, pin?: string): Promise<void> {
    const epoch = this.#captureMembership()
    const before = findSource(await this.#read(), id)
    this.#assertMember(epoch)
    this.#assertSourceMode(before.input)
    const input = this.#withPin(before.input, pin)
    const result = await this.#load(input).then(
      (catalog) => ({ ok: true, catalog }) as const,
      (error: unknown) => ({ ok: false, error }) as const,
    )
    await this.#change(epoch, async (records) => {
      const current = findSource(records, id)
      if (current.revision !== before.revision) throw new Error("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
      if (result.ok) assertUniqueSource(records, input, id)
      const next: SourceRecord = result.ok
        ? {
            ...current,
            input,
            catalog: result.catalog,
            catalogDigest: catalogDigest(result.catalog),
            refreshedAt: new Date().toISOString(),
            error: null,
          }
        : { ...current, error: refreshFailed }
      if (
        next.catalogDigest !== current.catalogDigest ||
        sourcePin(next.input) !== sourcePin(current.input)
      )
        next.revision = randomUUID()
      await this.#publish(replace(records, next), epoch, next.input)
    })
    if (!result.ok) throw result.error
  }

  /** 改变本机可见性，启停变更会撤销该来源尚未提交的安装准备。 */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const epoch = this.#captureMembership()
    return this.#change(epoch, async (records) => {
      const record = findSource(records, id)
      if (record.enabled === enabled) return
      await this.#publish(
        replace(records, { ...record, enabled, revision: randomUUID() }),
        epoch,
        enabled ? record.input : undefined,
      )
    })
  }

  /** 删除本机源和相应缓存，不修改已安装插件。 */
  async remove(id: string): Promise<void> {
    const epoch = this.#captureMembership()
    return this.#change(epoch, async (records) => {
      findSource(records, id)
      await this.#publish(
        records.filter((record) => record.id !== id),
        epoch,
      )
    })
  }

  /** 在主进程绑定来源版本；断言从实时会员和已发布状态重新核验该版本。 */
  async resolve(sourceId: string, entryId: string): Promise<PluginMarketplaceResolvedEntry> {
    const epoch = this.#captureMembership()
    const before = findSource(await this.#read(), sourceId)
    this.#assertMember(epoch)
    if (!before.enabled) throw new Error("PLUGIN_MARKETPLACE_SOURCE_DISABLED")
    const assertCurrent = () => {
      this.#assertMember(epoch)
      this.#assertSourceMode(before.input)
      if (
        !containsCurrent(this.#records, before) ||
        (this.#publishing !== undefined && !containsCurrent(this.#publishing, before))
      )
        throw new Error("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    }
    assertCurrent()
    const entry = before.catalog.entries.find(({ info }) => info.id === entryId)
    if (!entry) throw new Error("PLUGIN_MARKETPLACE_ENTRY_NOT_FOUND")
    return {
      input: structuredClone(before.input),
      entry: structuredClone(entry),
      assertCurrent,
    }
  }

  /** 通知成功发布的本机状态变更，订阅者失败不影响保存。 */
  subscribe(onChange: () => void): () => void {
    this.#listeners.add(onChange)
    return () => void this.#listeners.delete(onChange)
  }

  /** 会员离开 active 时吊销已取出的确认和尚未发布的下载。 */
  membershipChanged(state: MembershipState): void {
    if (state !== "active") this.invalidateRequests()
  }

  /** 当前入口权限变更时，使旧下载和确认失效。 */
  invalidateRequests(): void {
    this.#membershipEpoch++
  }

  #captureMembership(): number {
    const epoch = this.#membershipEpoch
    this.#assertMember(epoch)
    return epoch
  }

  #assertMember(epoch: number): void {
    if (this.options.membership() !== "active") throw new Error("MEMBERSHIP_REQUIRED")
    if (epoch !== this.#membershipEpoch) throw new Error("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
  }

  #assertSourceMode(input: PluginMarketplaceSourceInput): void {
    if (input.kind === "directory" && !this.options.developerMode())
      throw new Error("PLUGIN_DEVELOPER_MODE_REQUIRED")
  }

  #withPin(
    input: PluginMarketplaceSourceInput,
    pin: string | undefined,
  ): PluginMarketplaceSourceInput {
    if (pin === undefined) return input
    if (input.kind === "directory") throw new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
    const next = this.options.normalize(
      input.kind === "github" ? { ...input, commit: pin } : { ...input, sha256: pin },
    )
    if (next.kind !== input.kind || sourceLocation(next) !== sourceLocation(input))
      throw new Error("PLUGIN_MARKETPLACE_SOURCE_INVALID")
    return structuredClone(next)
  }

  async #load(input: PluginMarketplaceSourceInput): Promise<PluginMarketplaceCatalog> {
    const data = await this.options.load(structuredClone(input))
    const catalog = catalogSchema.safeParse(data)
    if (!catalog.success || !uniqueEntryIds(catalog.data))
      throw new Error("PLUGIN_MARKETPLACE_CATALOG_INVALID")
    return catalog.data
  }

  #read(): Promise<readonly SourceRecord[]> {
    if (this.#records !== undefined) return Promise.resolve(this.#records)
    return (this.#reading ??= this.#readCache()
      .then((records) => {
        this.#records = records
        return records
      })
      .finally(() => {
        this.#reading = undefined
      }))
  }

  async #readCache(): Promise<readonly SourceRecord[]> {
    try {
      const data = await readJson(this.options.path)
      if (data === undefined) return []
      const { sources } = cacheSchema.parse(data)
      const records = sources.map((record) => ({
        ...record,
        input: structuredClone(this.options.normalize(record.input)),
      }))
      if (
        new Set(records.map(({ id }) => id)).size !== records.length ||
        records.some(
          (record) =>
            !uniqueEntryIds(record.catalog) ||
            catalogDigest(record.catalog) !== record.catalogDigest,
        )
      )
        throw new Error("目录缓存不一致")
      return records
    } catch {
      throw new Error("PLUGIN_MARKETPLACE_CACHE_INVALID")
    }
  }

  #change(
    epoch: number,
    apply: (records: readonly SourceRecord[]) => Promise<void>,
  ): Promise<void> {
    const result = this.#writes.then(async () => {
      this.#assertMember(epoch)
      const records = await this.#read()
      this.#assertMember(epoch)
      await apply(records)
    })
    this.#writes = result.catch(() => undefined)
    return result
  }

  async #publish(
    records: readonly SourceRecord[],
    epoch: number,
    input?: PluginMarketplaceSourceInput,
  ): Promise<void> {
    // 写盘期间也拒绝已经进入发布流程的失效确认；失败则继续保留最后的已发布记录。
    this.#publishing = records
    try {
      await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 })
      await atomicJson(this.options.path, { schemaVersion: 1, sources: records }, () => {
        this.#assertMember(epoch)
        if (input !== undefined) this.#assertSourceMode(input)
      })
      this.#records = records
    } finally {
      this.#publishing = undefined
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener()
      } catch {
        // 本机缓存已经发布，个别订阅者错误不回滚它。
      }
    }
  }
}

function catalogDigest(catalog: PluginMarketplaceCatalog): string {
  return createHash("sha256").update(JSON.stringify(catalog)).digest("hex")
}

function uniqueEntryIds(catalog: PluginMarketplaceCatalog): boolean {
  return new Set(catalog.entries.map(({ info }) => info.id)).size === catalog.entries.length
}

function findSource(records: readonly SourceRecord[], id: string): SourceRecord {
  const result = records.find((record) => record.id === id)
  if (result === undefined) throw new Error("PLUGIN_MARKETPLACE_SOURCE_NOT_FOUND")
  return result
}

function containsCurrent(
  records: readonly SourceRecord[] | undefined,
  before: SourceRecord,
): boolean {
  const current = records?.find((record) => record.id === before.id)
  return (
    current?.enabled === true &&
    current.revision === before.revision &&
    current.catalogDigest === before.catalogDigest
  )
}

function replace(records: readonly SourceRecord[], next: SourceRecord): SourceRecord[] {
  return records.map((record) => (record.id === next.id ? next : record))
}

function sourcePin(input: PluginMarketplaceSourceInput): string | null {
  return input.kind === "github" ? input.commit : input.kind === "https" ? input.sha256 : null
}

function sourceLocation(input: PluginMarketplaceSourceInput): string {
  return input.kind === "github" ? input.repo : input.kind === "https" ? input.url : input.path
}

function assertUniqueSource(
  records: readonly SourceRecord[],
  input: PluginMarketplaceSourceInput,
  exceptId?: string,
): void {
  if (
    records.some(
      (record) =>
        record.id !== exceptId &&
        record.input.kind === input.kind &&
        sourceLocation(record.input) === sourceLocation(input) &&
        sourcePin(record.input) === sourcePin(input),
    )
  )
    throw new Error("PLUGIN_MARKETPLACE_SOURCE_EXISTS")
}

function sourceLabel(input: PluginMarketplaceSourceInput): string {
  switch (input.kind) {
    case "github":
      return input.repo + "@" + input.commit.slice(0, 8)
    case "https": {
      const url = new URL(input.url)
      return url.origin + url.pathname
    }
    case "directory":
      return input.path
  }
}

function viewOf(record: SourceRecord): PluginMarketplaceSourceView {
  return {
    id: record.id,
    kind: record.input.kind,
    pin: sourcePin(record.input),
    label: sourceLabel(record.input),
    catalogName: record.catalog.name,
    enabled: record.enabled,
    refreshedAt: record.refreshedAt,
    entryCount: record.catalog.entries.length,
    error: record.error,
  }
}
