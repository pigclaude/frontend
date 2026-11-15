// 记录可信官方目录的吊销规则，立即撤销已装版本的资格，再持久化对应状态。
import type { CapabilityPluginRecords, DesktopPluginRecord } from "./capability-plugin-records"
import type { PluginMarketplaceProvenance } from "./plugin-marketplace-catalog"

const revokedError = "PLUGIN_MARKETPLACE_PLUGIN_REVOKED"

/** 已经通过官方目录验签的插件吊销作用域。 */
export type PluginMarketplaceRevocation = Readonly<{
  name: string
  repo: string
  sha?: string
  reason: string
}>

type OfficialRevocations = { sourceId: string; entries: readonly PluginMarketplaceRevocation[] }
type RevokedPlugin = { name: string; reason: string }

/** 区分当前目录规则与已撤销的具体安装版本。 */
export class MarketplacePluginRevocations {
  readonly #rules = new Map<string, OfficialRevocations>()
  readonly #pending = new Set<OfficialRevocations>()
  readonly #withdrawn = new Map<string, { revision: string; reason: string }>()

  /** 入队前接收已验的规则；已装版本即使尚未写盘也不再授权。 */
  accept(sourceId: string, entries: readonly PluginMarketplaceRevocation[]): OfficialRevocations {
    const update = {
      sourceId,
      entries: entries.map(({ repo, sha, ...entry }) => ({
        ...entry,
        repo: repo.toLowerCase(),
        ...(sha === undefined ? {} : { sha: sha.toLowerCase() }),
      })),
    }
    this.#rules.set(sourceId, update)
    this.#pending.add(update)
    return update
  }

  /** 拒绝仍命中当前官方规则的候选包，包括未安装的版本。 */
  assertPackageAllowed(provenance: PluginMarketplaceProvenance): void {
    if (matchingReason(this.#rules.get(provenance.sourceId), provenance) !== undefined)
      throw new Error(revokedError)
  }

  /** 针对同一个已装版本查询持久或尚未落盘的吊销。 */
  reasonFor(record: DesktopPluginRecord): string | undefined {
    const provenance = record.marketplace
    if (provenance !== undefined) {
      const current = matchingReason(this.#rules.get(provenance.sourceId), provenance)
      if (current !== undefined) return current
      for (const update of this.#pending) {
        const pending = matchingReason(update, provenance)
        if (pending !== undefined) return pending
      }
    }
    const withdrawn = this.#withdrawn.get(record.manifest.id)
    return (
      (withdrawn?.revision === record.revision ? withdrawn.reason : undefined) ??
      record.revocationReason
    )
  }

  /** 重新启用仍在原修订的插件须先通过当前和已持久化的吊销检查。 */
  assertEnabledAllowed(record: DesktopPluginRecord): void {
    if (this.reasonFor(record) !== undefined) throw new Error(revokedError)
  }

  /** 已吊销的版本只能替换为不同的固定 GitHub 版本；返回是否应保持禁用。 */
  replacingRevokedVersion(
    record: DesktopPluginRecord,
    next: PluginMarketplaceProvenance | undefined,
  ): boolean {
    if (this.reasonFor(record) === undefined) return false
    if (
      !next?.repo ||
      !next.commit ||
      (record.marketplace?.repo?.toLowerCase() === next.repo.toLowerCase() &&
        record.marketplace?.commit === next.commit)
    )
      throw new Error(revokedError)
    return true
  }

  /** 发布新修订或卸载后释放旧修订的内存记录。 */
  forget(pluginId: string): void {
    this.#withdrawn.delete(pluginId)
  }

  /** 在管理器写队列中尽力停止每个命中的 Worker，并原子保存安装状态。 */
  async persist(
    update: OfficialRevocations,
    records: CapabilityPluginRecords,
    stopInstances: (id: string) => Promise<void> | void,
    publishChange: () => void,
  ): Promise<readonly RevokedPlugin[]> {
    try {
      const changes = (await records.list()).flatMap((record) => {
        const reason = matchingReason(update, record.marketplace)
        if (reason === undefined) return []
        const { id } = record.manifest
        this.#withdrawn.set(id, { revision: record.revision, reason })
        return record.enabled || record.revocationReason !== reason ? [{ record, reason }] : []
      })
      if (changes.length === 0) return []
      const writes = await Promise.allSettled(
        changes.map(async ({ record, reason }) => {
          if (record.type === "capability") {
            try {
              await stopInstances(record.manifest.id)
            } catch {
              // Worker 停止失败不能解除吊销或阻止写入禁用状态。
            }
          }
          await records.setRecord({ ...record, enabled: false, revocationReason: reason })
          return { name: record.manifest.id, reason }
        }),
      )
      publishChange()
      return writes.map((result) => {
        if (result.status === "rejected") throw result.reason
        return result.value
      })
    } finally {
      this.#pending.delete(update)
    }
  }
}

function matchingReason(
  update: OfficialRevocations | undefined,
  provenance: PluginMarketplaceProvenance | undefined,
): string | undefined {
  if (!provenance?.repo || !update || provenance.sourceId !== update.sourceId) return undefined
  const repo = provenance.repo.toLowerCase()
  return update.entries.find(
    (entry) =>
      entry.name === provenance.entryId &&
      entry.repo === repo &&
      (entry.sha === undefined || entry.sha === provenance.commit),
  )?.reason
}
