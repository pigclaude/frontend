// 管理安装披露、不可变包副本、启停和卸载；供会话宿主读取已启用的快照。

import { randomUUID } from "node:crypto"
import { isAbsolute } from "node:path"
import { keepsMembershipRuntime, type MembershipState } from "@pigclaude/contracts/membership"
import type {
  CapabilityPluginInstallDisclosure,
  CapabilityPluginInstallSource,
  CapabilityPluginManifest,
  InstalledCapabilityPlugin,
} from "../../capability-plugin-contract"
import {
  readCapabilityPluginDirectory,
  validateCapabilityPluginBundle,
  type CapabilityPluginBundle,
} from "./capability-plugin-bundle"
import { isCapabilityPluginCompatible } from "./capability-plugin-manifest"
import { capabilityPluginStoragePaths, isCapabilityPluginId } from "./capability-plugin-paths"
import { CapabilityPluginRecords, type CapabilityPluginRecord } from "./capability-plugin-records"

type Pending = {
  disclosure: CapabilityPluginInstallDisclosure
  bundle: CapabilityPluginBundle
  expires: number
  epoch: number
}

/** 安装与生命周期依赖应用提供的当前会员、开发模式和沙箱清理入口。 */
export type CapabilityPluginManagerOptions = {
  root: string
  appVersion: string
  membership: () => MembershipState
  developerMode: () => boolean
  readArchive: (path: string, sha256: string) => Promise<ReadonlyMap<string, Buffer>>
  stopInstances: (pluginId?: string) => void | Promise<void>
}

/** 会话启动时获取的快照，仅供主进程接入插件沙箱。 */
export type CapabilityPluginSnapshot = {
  manifest: CapabilityPluginManifest
  revision: string
  modules: Readonly<Record<string, string>>
  approvedDomains: readonly string[]
  dataDirectory: string
  secretsFile: string
}

/** 由应用主进程持有的一份插件管理器；修改串行发布。 */
export class CapabilityPluginManager {
  readonly #records: CapabilityPluginRecords
  readonly #listeners = new Set<() => void>()
  readonly #withdrawing = new Set<string>()
  readonly #withdrawalEpochs = new Map<string, number>()
  #pending = new WeakMap<object, Pending>()
  #epoch = 0
  #writes = Promise.resolve()

  /** 绑定私有安装根、沙箱清理和版本信息。 */
  constructor(private readonly options: CapabilityPluginManagerOptions) {
    this.#records = new CapabilityPluginRecords(options.root)
  }

  /** 仅供管理页确定是否提供目录安装入口。 */
  status(): { developerMode: boolean } {
    return { developerMode: this.options.developerMode() }
  }

  /** 列出已安装插件；待清理的卸载目录不会重新出现。 */
  list(): Promise<InstalledCapabilityPlugin[]> {
    return this.#enqueue(async () => {
      for (const id of await this.#records.removingIds())
        await this.#finishRemoval(id).catch(() => undefined)
      return (await this.#installed()).map((record) => this.#describe(record))
    })
  }

  /** 读取现成模块和清单，返回绑定当前可信窗口的一次性披露。 */
  async prepare(
    source: CapabilityPluginInstallSource,
    owner: object,
  ): Promise<CapabilityPluginInstallDisclosure> {
    this.#assertMayInstall(source.kind)
    const epoch = this.#epoch
    this.#pending.delete(owner)
    if (!isAbsolute(source.path) || source.path.includes("\0"))
      throw new Error("PLUGIN_SOURCE_INVALID")
    if (source.kind === "archive" && typeof source.sha256 !== "string")
      throw new Error("PLUGIN_ARCHIVE_SHA256_INVALID")
    const sha256 = source.kind === "archive" ? source.sha256.toLowerCase() : null
    if (sha256 !== null && !/^[0-9a-f]{64}$/.test(sha256))
      throw new Error("PLUGIN_ARCHIVE_SHA256_INVALID")
    const files =
      sha256 === null
        ? await readCapabilityPluginDirectory(source.path)
        : await this.options.readArchive(source.path, sha256)
    const bundle = validateCapabilityPluginBundle(files, this.options.appVersion)
    this.#assertMayInstall(source.kind, epoch)
    const disclosure: CapabilityPluginInstallDisclosure = {
      type: "capability",
      confirmationId: randomUUID(),
      manifest: bundle.manifest,
      sourceKind: source.kind,
      sha256,
    }
    this.#pending.set(owner, { bundle, disclosure, epoch, expires: Date.now() + 300_000 })
    return structuredClone(disclosure)
  }

  /** 用户确认的域名和已披露的模块在同一次安装中绑定，不重新读取原来源。 */
  confirm(confirmationId: string, owner: object): Promise<InstalledCapabilityPlugin> {
    return this.#enqueue(async () => {
      const pending = this.#pending.get(owner)
      if (
        !pending ||
        pending.disclosure.confirmationId !== confirmationId ||
        pending.expires <= Date.now()
      )
        throw new Error("PLUGIN_CONFIRMATION_INVALID")
      this.#pending.delete(owner)
      const { bundle, disclosure, epoch } = pending
      const { manifest } = bundle
      this.#assertMayInstall(disclosure.sourceKind, epoch)
      if (await this.#records.read(manifest.id)) throw new Error("PLUGIN_ALREADY_INSTALLED")
      await this.#finishRemoval(manifest.id)
      const record: CapabilityPluginRecord = {
        type: "capability",
        manifest,
        revision: randomUUID(),
        installedAt: new Date().toISOString(),
        sourceKind: disclosure.sourceKind,
        sha256: disclosure.sha256,
        approvedDomains: [...manifest.networkDomains],
        enabled: true,
      }
      await this.#records.install(record, bundle, () =>
        this.#assertMayInstall(disclosure.sourceKind, epoch),
      )
      this.#emit()
      return this.#describe(record)
    })
  }

  /** 放弃当前窗口匹配的待确认内容。 */
  cancel(confirmationId: string, owner: object): void {
    if (this.#pending.get(owner)?.disclosure.confirmationId === confirmationId)
      this.#pending.delete(owner)
  }

  /** 启用需要有效会员。停用只改变下次会话能获取的快照。 */
  setEnabled(pluginId: string, enabled: boolean): Promise<InstalledCapabilityPlugin> {
    assertId(pluginId)
    return this.#enqueue(async () => {
      if (enabled) this.#assertActive()
      const record = await this.#records.read(pluginId)
      if (!record) throw new Error("PLUGIN_NOT_INSTALLED")
      if (enabled && !isCapabilityPluginCompatible(record.manifest, this.options.appVersion))
        throw new Error("PLUGIN_VERSION_INCOMPATIBLE")
      const updated = { ...record, enabled }
      if (record.enabled !== enabled) {
        await this.#records.setRecord(updated, enabled ? () => this.#assertActive() : undefined)
        this.#emit()
      }
      return this.#describe(updated)
    })
  }

  /** 先撤销旧版本的调用资格，再等待实例关闭并清理密钥与文件。 */
  uninstall(pluginId: string, keepData: boolean): Promise<void> {
    assertId(pluginId)
    return this.#enqueue(async () => {
      if (await this.#records.read(pluginId)) {
        this.#withdrawing.add(pluginId)
        this.#withdrawalEpochs.set(pluginId, (this.#withdrawalEpochs.get(pluginId) ?? 0) + 1)
        try {
          await this.#records.withdraw(pluginId, keepData)
          this.#emit()
        } finally {
          this.#withdrawing.delete(pluginId)
        }
      } else if (!(await this.#records.removalPlan(pluginId))) {
        throw new Error("PLUGIN_NOT_INSTALLED")
      }
      await this.#finishRemoval(pluginId)
    })
  }

  /** 启动会话时读取当前启用且兼容的模块副本。损坏的一个包不会阻止其他会话启动。 */
  snapshotEnabled(): Promise<CapabilityPluginSnapshot[]> {
    return this.#enqueue(async () => {
      if (this.options.membership() !== "active") return []
      const epoch = this.#epoch
      const plugins = await Promise.all(
        (await this.#installed()).flatMap((record) =>
          record.enabled && isCapabilityPluginCompatible(record.manifest, this.options.appVersion)
            ? [this.#snapshot(record).catch(() => null)]
            : [],
        ),
      )
      return this.#epoch === epoch && this.options.membership() === "active"
        ? plugins.filter((value) => value !== null)
        : []
    })
  }

  /** 调用时核对有效会员和仍存在的安装版本；已获快照的会话不受停用影响。 */
  async canInvoke(pluginId: string, revision: string): Promise<boolean> {
    if (
      !isCapabilityPluginId(pluginId) ||
      this.#withdrawing.has(pluginId) ||
      this.options.membership() !== "active"
    )
      return false
    const epoch = this.#epoch
    const withdrawal = this.#withdrawalEpochs.get(pluginId)
    const record = await this.#records.read(pluginId).catch(() => null)
    return (
      epoch === this.#epoch &&
      withdrawal === this.#withdrawalEpochs.get(pluginId) &&
      this.options.membership() === "active" &&
      !this.#withdrawing.has(pluginId) &&
      record?.revision === revision &&
      isCapabilityPluginCompatible(record.manifest, this.options.appVersion)
    )
  }

  /** 会员失效撤销待确认安装并停止全部实例；短暂网络宽限保留现有实例。 */
  async membershipChanged(state: MembershipState): Promise<void> {
    if (state !== "active") {
      this.#epoch += 1
      this.#pending = new WeakMap()
    }
    if (!keepsMembershipRuntime(state)) await this.options.stopInstances()
  }

  /** 订阅经过落盘的安装列表变化。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  #describe(record: CapabilityPluginRecord): InstalledCapabilityPlugin {
    return {
      ...record,
      compatible: isCapabilityPluginCompatible(record.manifest, this.options.appVersion),
    }
  }

  async #installed(): Promise<CapabilityPluginRecord[]> {
    const records = await Promise.all(
      (await this.#records.listIds()).map((id) => this.#records.read(id).catch(() => null)),
    )
    return records.filter((record) => record !== null)
  }

  async #snapshot(record: CapabilityPluginRecord): Promise<CapabilityPluginSnapshot> {
    const files = await readCapabilityPluginDirectory(
      this.#records.packageDirectory(record.manifest.id),
    )
    const { manifest, modules } = validateCapabilityPluginBundle(files, this.options.appVersion)
    if (JSON.stringify(manifest) !== JSON.stringify(record.manifest))
      throw new Error("PLUGIN_RECORD_INVALID")
    return {
      manifest,
      modules,
      revision: record.revision,
      approvedDomains: record.approvedDomains,
      ...capabilityPluginStoragePaths(this.options.root, manifest.id),
    }
  }

  async #finishRemoval(id: string): Promise<void> {
    const plan = await this.#records.removalPlan(id)
    if (plan === null) return
    await this.options.stopInstances(id)
    await this.#records.cleanRemoval(id, plan.keepData)
  }

  #assertActive(): void {
    if (this.options.membership() !== "active") throw new Error("MEMBERSHIP_REQUIRED")
  }

  #assertMayInstall(kind: CapabilityPluginInstallSource["kind"], epoch = this.#epoch): void {
    this.#assertActive()
    if (epoch !== this.#epoch) throw new Error("PLUGIN_CONFIRMATION_INVALID")
    if (kind === "directory" && !this.options.developerMode())
      throw new Error("PLUGIN_DEVELOPER_MODE_REQUIRED")
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener()
      } catch {
        // 已经落盘的操作不受某个订阅者错误影响。
      }
    }
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writes.then(operation)
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function assertId(id: string): void {
  if (!isCapabilityPluginId(id)) throw new Error("PLUGIN_ID_INVALID")
}
