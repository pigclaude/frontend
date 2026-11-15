// 管理安装披露、不可变包副本、启停和卸载；供会话宿主读取已启用的快照。

import { keepsMembershipRuntime, type MembershipState } from "@pigclaude/contracts/membership"
import type {
  CapabilityPluginInstallSource,
  CapabilityPluginToolApproval,
  CapabilityPluginRevision,
  DesktopPluginInstallDisclosure,
  InstalledCapabilityPlugin,
  InstalledDesktopPlugin,
} from "../../capability-plugin-contract"
import type { PluginMarketplaceUpdateResult } from "../../plugin-marketplace-contract"
import { CapabilityPluginAuthorization } from "./capability-plugin-authorization"
import { isCapabilityPluginId } from "./capability-plugin-paths"
import {
  CapabilityPluginRecords,
  type CapabilityPluginRecord,
  type ClaudeCodePluginRecord,
  type DesktopPluginRecord,
} from "./capability-plugin-records"
import {
  describeInstalledPlugin,
  isDesktopPluginCompatible,
  type CapabilityPluginSnapshot,
} from "./capability-plugin-snapshot"
import { loadLocalDesktopPlugin } from "./desktop-plugin-bundle"
import {
  createDesktopPluginRecord,
  DesktopPluginInstallReview,
  expandedPluginAccess,
  marketplaceFilesChanged,
  marketplaceInstallPlan,
  type DesktopPluginInstallPlan,
  type PluginMarketplaceInstallRequest,
} from "./desktop-plugin-installation"
import {
  MarketplacePluginRevocations,
  type PluginMarketplaceRevocation,
} from "./marketplace-plugin-revocations"
import type { PluginMarketplaceProvenance } from "./plugin-marketplace-catalog"

/** 安装与生命周期依赖应用提供的当前会员、开发模式和沙箱清理入口。 */
export type CapabilityPluginManagerOptions = {
  root: string
  appVersion: string
  membership: () => MembershipState
  developerMode: () => boolean
  readArchive: (path: string, sha256: string) => Promise<ReadonlyMap<string, Buffer>>
  stopInstances: (pluginId?: string) => void | Promise<void>
}

export type { CapabilityPluginSnapshot } from "./capability-plugin-snapshot"

/** 由应用主进程持有的一份插件管理器；修改串行发布。 */
export class CapabilityPluginManager {
  readonly #records: CapabilityPluginRecords
  readonly #listeners = new Set<() => void>()
  readonly #authorization: CapabilityPluginAuthorization
  readonly #review = new DesktopPluginInstallReview()
  readonly #revocations = new MarketplacePluginRevocations()
  #epoch = 0
  #writes = Promise.resolve()

  /** 绑定私有安装根、沙箱清理和版本信息。 */
  constructor(private readonly options: CapabilityPluginManagerOptions) {
    this.#records = new CapabilityPluginRecords(options.root)
    this.#authorization = new CapabilityPluginAuthorization({
      records: this.#records,
      revocations: this.#revocations,
      appVersion: options.appVersion,
      active: () => options.membership() === "active",
      membershipEpoch: () => this.#epoch,
    })
  }

  /** 仅供管理页确定是否提供目录安装入口。 */
  status(): { developerMode: boolean } {
    return { developerMode: this.options.developerMode() }
  }

  /** 列出已安装插件；待清理的卸载目录不会重新出现。 */
  list(): Promise<InstalledDesktopPlugin[]> {
    return this.#enqueue(async () => {
      for (const id of await this.#records.removingIds())
        await this.#finishRemoval(id).catch(() => undefined)
      return (await this.#records.list()).map((record) => this.#describe(record))
    })
  }

  /** 读取能力包或 Claude Code 组件，返回绑定当前可信窗口的一次性披露。 */
  async prepare(
    source: CapabilityPluginInstallSource,
    owner: object,
  ): Promise<DesktopPluginInstallDisclosure> {
    this.#assertMayInstall(source.kind)
    const epoch = this.#epoch
    const assertCurrent = this.#review.begin(owner)
    const { bundle, sha256 } = await loadLocalDesktopPlugin(
      source,
      this.options.appVersion,
      this.options.readArchive,
    )
    this.#assertMayInstall(source.kind, epoch)
    assertCurrent()
    return this.#review.prepare(owner, { bundle, sourceKind: source.kind, sha256, epoch })
  }

  /** 在市场读取前登记当前窗口，供后续发布复核。 */
  beginInstallReview(owner: object): () => void {
    return this.#review.begin(owner)
  }

  /** 市场列表用安装标识和确切来源判定安装或更新动作。 */
  marketplaceInstallations(): Promise<ReadonlyMap<string, PluginMarketplaceProvenance | null>> {
    return this.#enqueue(
      async () =>
        new Map(
          (await this.#records.list()).map((record) => [
            record.manifest.id,
            record.marketplace ?? null,
          ]),
        ),
    )
  }

  /** 为市场读取器已经校验的包开启与本地安装相同的披露流程。 */
  prepareMarketplaceInstall(
    request: PluginMarketplaceInstallRequest,
    owner: object,
  ): Promise<DesktopPluginInstallDisclosure> {
    return this.#enqueue(async () => {
      const plan = marketplaceInstallPlan(request, this.#epoch)
      this.#assertInstallPlan(plan)
      if (await this.#records.read(plan.bundle.manifest.id))
        throw new Error("PLUGIN_ALREADY_INSTALLED")
      this.#assertInstallPlan(plan)
      return this.#review.prepare(owner, plan)
    })
  }

  /** 手动更新同一市场项，验过的包发生增权或需要重新确认文件时创建披露。 */
  prepareMarketplaceUpdate(
    request: PluginMarketplaceInstallRequest,
    owner: object,
  ): Promise<PluginMarketplaceUpdateResult> {
    return this.#enqueue(async () => {
      const plan = marketplaceInstallPlan(request, this.#epoch)
      this.#assertInstallPlan(plan)
      const current = await this.#records.read(plan.bundle.manifest.id)
      const { provenance } = request
      if (
        current?.type !== plan.bundle.type ||
        current.marketplace?.sourceId !== provenance.sourceId ||
        current.marketplace.entryId !== provenance.entryId
      )
        throw new Error("PLUGIN_MARKETPLACE_INSTALLATION_MISMATCH")
      this.#assertInstallPlan(plan)
      const recovery = this.#revocations.replacingRevokedVersion(current, provenance)
      if (!recovery && !marketplaceFilesChanged(current.marketplace, provenance))
        return { kind: "unchanged" }
      const update = { ...plan, previousRevision: current.revision }
      const grown = expandedPluginAccess(current, plan.bundle)
      const fileHashChanged = request.requireFileReview === true
      if (fileHashChanged || grown.additionalPermissions.length || grown.additionalDomains.length)
        return {
          kind: "review",
          disclosure: this.#review.prepare(owner, update),
          ...grown,
          ...(fileHashChanged ? { fileHashChanged: true as const } : {}),
        }
      await this.#publish(update)
      return { kind: "updated" }
    })
  }

  /** 应用官方入口交付的已验吊销列表；入队前撤回命中版本的运行资格。 */
  applyMarketplaceRevocations(
    sourceId: string,
    revocations: readonly PluginMarketplaceRevocation[],
  ): Promise<readonly { id: string; name: string; reason: string }[]> {
    const update = this.#revocations.accept(sourceId, revocations)
    return this.#enqueue(() =>
      this.#revocations.persist(update, this.#records, this.options.stopInstances, () =>
        this.#emit(),
      ),
    )
  }

  /** 发布用户确认时看到的同一份快照，无需重新读取原来源。 */
  confirm(confirmationId: string, owner: object): Promise<InstalledDesktopPlugin> {
    return this.#enqueue(() => this.#publish(this.#review.consume(owner, confirmationId)))
  }

  /** 放弃当前窗口匹配的待确认内容。 */
  cancel(confirmationId: string, owner: object): void {
    this.#review.cancel(owner, confirmationId)
  }

  /** 启用需要有效会员。停用只改变下次会话能获取的快照。 */
  setEnabled(pluginId: string, enabled: boolean): Promise<InstalledDesktopPlugin> {
    assertId(pluginId)
    return this.#enqueue(async () => {
      if (enabled) this.#assertActive()
      const record = await this.#records.read(pluginId)
      if (!record) throw new Error("PLUGIN_NOT_INSTALLED")
      const assertEnabled = () => {
        this.#assertActive()
        this.#revocations.assertEnabledAllowed(record)
      }
      if (enabled) {
        assertEnabled()
        if (!isDesktopPluginCompatible(record, this.options.appVersion))
          throw new Error("PLUGIN_VERSION_INCOMPATIBLE")
      }
      const updated = { ...record, enabled }
      if (record.enabled !== enabled) {
        await this.#records.setRecord(updated, enabled ? assertEnabled : undefined)
        this.#emit()
      }
      return this.#describe(updated)
    })
  }

  /** 保存新会话的询问档；已有会话的工具快照继续沿用。 */
  setToolApproval(
    id: string,
    mode: CapabilityPluginToolApproval,
  ): Promise<InstalledCapabilityPlugin> {
    assertId(id)
    return this.#enqueue(async () => {
      const record = await this.#records.read(id)
      if (!record || record.type !== "capability") throw new Error("PLUGIN_NOT_INSTALLED")
      if (record.toolApproval === mode) return this.#describe(record)
      const updated = { ...record, toolApproval: mode }
      await this.#records.setRecord(updated)
      this.#emit()
      return this.#describe(updated)
    })
  }

  /** 先撤销旧版本的调用资格，再等待实例关闭并清理密钥与文件。 */
  uninstall(pluginId: string, keepData: boolean): Promise<void> {
    assertId(pluginId)
    return this.#enqueue(async () => {
      if (await this.#records.read(pluginId)) {
        await this.#authorization.duringWithdrawal(pluginId, async () => {
          await this.#records.withdraw(pluginId, keepData)
          this.#emit()
        })
      } else if (!(await this.#records.removalPlan(pluginId))) {
        throw new Error("PLUGIN_NOT_INSTALLED")
      }
      await this.#finishRemoval(pluginId)
    })
  }

  /** 在启停和卸载队列中执行当前已启用版本的短操作。 */
  withEnabledPlugin<T>(
    { pluginId, revision }: CapabilityPluginRevision,
    operation: (plugin: CapabilityPluginRecord) => T | Promise<T>,
  ): Promise<T> {
    assertId(pluginId)
    return this.#enqueue(async () => {
      this.#assertActive()
      const record = await this.#records.read(pluginId)
      this.#assertActive()
      if (
        record?.type !== "capability" ||
        record.revision !== revision ||
        !record.enabled ||
        this.#revocations.reasonFor(record) !== undefined
      )
        throw new Error("PLUGIN_DECLARATION_UNAVAILABLE")
      if (!isDesktopPluginCompatible(record, this.options.appVersion))
        throw new Error("PLUGIN_VERSION_INCOMPATIBLE")
      return operation(record)
    })
  }

  /** 只为当前启用版本中清单声明的命令读取沙箱快照。 */
  commandSnapshot(
    plugin: CapabilityPluginRevision,
    commandId: string,
  ): Promise<CapabilityPluginSnapshot> {
    return this.withEnabledPlugin(plugin, (record) => {
      if (!record.manifest.commands.some(({ id }) => id === commandId))
        throw new Error("PLUGIN_DECLARATION_UNAVAILABLE")
      return this.#records.snapshot(record, this.options.appVersion)
    })
  }

  /** 启动会话时读取当前启用且兼容的模块副本。损坏的一个包不会阻止其他会话启动。 */
  snapshotEnabled(): Promise<CapabilityPluginSnapshot[]> {
    return this.#enqueue(async () => {
      if (this.options.membership() !== "active") return []
      const epoch = this.#epoch
      const records = (await this.#records.list()).filter(
        (record): record is CapabilityPluginRecord =>
          record.type === "capability" &&
          record.enabled &&
          isDesktopPluginCompatible(record, this.options.appVersion) &&
          this.#revocations.reasonFor(record) === undefined,
      )
      const plugins = await Promise.all(
        records.map(async (record) => ({
          record,
          snapshot: await this.#records.snapshot(record, this.options.appVersion).catch(() => null),
        })),
      )
      return this.#epoch === epoch && this.options.membership() === "active"
        ? plugins.flatMap(({ record, snapshot }) =>
            snapshot !== null && this.#revocations.reasonFor(record) === undefined
              ? [snapshot]
              : [],
          )
        : []
    })
  }

  /** 在会话私有目录中准备当次启动的允许组件，先前会话持有自己的副本。 */
  stageClaudeCodePlugins(directory: string): Promise<readonly string[]> {
    return this.#enqueue(async () => {
      const epoch = this.#epoch
      const staged: { record: ClaudeCodePluginRecord; path: string }[] = []
      for (const record of await this.#enabledClaudeCodePlugins()) {
        if (this.options.membership() !== "active" || epoch !== this.#epoch) return []
        const path = await this.#records.stageClaudeCodePlugin(record, directory).catch(() => null)
        if (path !== null) staged.push({ record, path })
      }
      if (epoch !== this.#epoch || this.options.membership() !== "active") return []
      return staged.flatMap(({ record, path }) =>
        this.#revocations.reasonFor(record) === undefined ? [path] : [],
      )
    })
  }

  /** 草稿菜单使用启用记录中的 Claude Code 完整命令名。 */
  claudeCodePluginCommands(): Promise<readonly string[]> {
    return this.#enqueue(async () => {
      const epoch = this.#epoch
      const enabled = await this.#enabledClaudeCodePlugins()
      if (epoch !== this.#epoch || this.options.membership() !== "active") return []
      return enabled.flatMap((record) =>
        this.#revocations.reasonFor(record) === undefined ? record.menuCommands : [],
      )
    })
  }

  /** 核对有效会员、安装修订和官方吊销。 */
  canInvoke(pluginId: string, revision: string): Promise<boolean> {
    return this.#authorization.canInvoke(pluginId, revision)
  }

  /** 串行执行一次能力请求，实际发布数据前重新校验授权。 */
  runCapability<T>(
    pluginId: string,
    revision: string,
    signal: AbortSignal,
    operation: (assertCurrent: () => void) => T | Promise<T>,
  ): Promise<T> {
    const call = { pluginId, revision, signal, membershipEpoch: this.#epoch }
    return this.#enqueue(() => this.#authorization.run(call, operation))
  }

  /** 会员失效撤销待确认安装并停止全部实例；短暂网络宽限保留现有实例。 */
  async membershipChanged(state: MembershipState): Promise<void> {
    if (state !== "active") {
      this.#epoch += 1
      this.#review.reset()
    }
    if (!keepsMembershipRuntime(state)) await this.options.stopInstances()
  }

  /** 订阅经过落盘的安装列表变化。 */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  #describe(record: CapabilityPluginRecord): InstalledCapabilityPlugin
  #describe(record: DesktopPluginRecord): InstalledDesktopPlugin
  #describe(record: DesktopPluginRecord): InstalledDesktopPlugin {
    return describeInstalledPlugin(
      record,
      this.options.appVersion,
      this.#revocations.reasonFor(record),
    )
  }

  async #enabledClaudeCodePlugins() {
    if (this.options.membership() !== "active") return []
    return (await this.#records.list()).filter(
      (record): record is ClaudeCodePluginRecord =>
        record.type === "claude-code" &&
        record.enabled &&
        this.#revocations.reasonFor(record) === undefined,
    )
  }

  #assertInstallPlan(plan: DesktopPluginInstallPlan): void {
    if (plan.market === undefined) return this.#assertMayInstall(plan.sourceKind, plan.epoch)
    this.#assertActive()
    if (plan.epoch !== this.#epoch) throw new Error("PLUGIN_CONFIRMATION_INVALID")
    plan.market.assertCurrent()
    this.#revocations.assertPackageAllowed(plan.market.provenance)
  }

  async #publish(plan: DesktopPluginInstallPlan): Promise<InstalledDesktopPlugin> {
    const assertCurrent = () => this.#assertInstallPlan(plan)
    assertCurrent()
    const id = plan.bundle.manifest.id
    const previous = await this.#records.read(id)
    if (plan.previousRevision === undefined) {
      if (previous) throw new Error("PLUGIN_ALREADY_INSTALLED")
      await this.#finishRemoval(id)
      const record = createDesktopPluginRecord(plan)
      await this.#records.install(record, plan.bundle, assertCurrent)
      this.#emit()
      return this.#describe(record)
    }
    if (previous?.revision !== plan.previousRevision) throw new Error("PLUGIN_CONFIRMATION_INVALID")
    const recovery = () =>
      this.#revocations.replacingRevokedVersion(previous, plan.market?.provenance)
    const record = {
      ...createDesktopPluginRecord(plan, recovery() ? { ...previous, enabled: false } : previous),
      packageRevision: true as const,
    }
    const assertReplacement = () => {
      assertCurrent()
      if (recovery() && record.enabled) throw new Error("PLUGIN_CONFIRMATION_INVALID")
    }
    await this.#authorization.duringWithdrawal(id, async () => {
      assertReplacement()
      await this.options.stopInstances(id)
      await this.#records.replace(previous, record, plan.bundle, assertReplacement)
    })
    this.#revocations.forget(id)
    this.#emit()
    return this.#describe(record)
  }

  async #finishRemoval(id: string): Promise<void> {
    const plan = await this.#records.removalPlan(id)
    if (plan === null) return
    await this.options.stopInstances(id)
    await this.#records.cleanRemoval(id, plan.keepData)
    this.#revocations.forget(id)
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
