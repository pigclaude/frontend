// 管理安装披露、不可变包副本、启停和卸载；供会话宿主读取已启用的快照。

import { randomUUID } from "node:crypto"
import { basename, isAbsolute } from "node:path"
import { keepsMembershipRuntime, type MembershipState } from "@pigclaude/contracts/membership"
import type {
  CapabilityPluginInstallSource,
  CapabilityPluginToolApproval,
  CapabilityPluginRevision,
  DesktopPluginInstallDisclosure,
  InstalledCapabilityPlugin,
  InstalledDesktopPlugin,
} from "../../capability-plugin-contract"
import {
  readCapabilityPluginDirectory,
  validateCapabilityPluginBundle,
} from "./capability-plugin-bundle"
import { isCapabilityPluginCompatible } from "./capability-plugin-manifest"
import { capabilityPluginStoragePaths, isCapabilityPluginId } from "./capability-plugin-paths"
import {
  CapabilityPluginRecords,
  type CapabilityPluginRecord,
  type ClaudeCodePluginRecord,
  type DesktopPluginRecord,
} from "./capability-plugin-records"
import type { CapabilityPluginSnapshot } from "./capability-plugin-snapshot"
import {
  pluginBundleFilesDigest,
  readDesktopPluginDirectory,
  validateDesktopPluginBundle,
  type DesktopPluginBundle,
} from "./desktop-plugin-bundle"
import { PluginSandboxError } from "./plugin-sandbox-contract"

type Pending = {
  disclosure: DesktopPluginInstallDisclosure
  bundle: DesktopPluginBundle
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

export type { CapabilityPluginSnapshot } from "./capability-plugin-snapshot"

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
  list(): Promise<InstalledDesktopPlugin[]> {
    return this.#enqueue(async () => {
      for (const id of await this.#records.removingIds())
        await this.#finishRemoval(id).catch(() => undefined)
      return (await this.#installed()).map((record) => this.#describe(record))
    })
  }

  /** 读取能力包或 Claude Code 组件，返回绑定当前可信窗口的一次性披露。 */
  async prepare(
    source: CapabilityPluginInstallSource,
    owner: object,
  ): Promise<DesktopPluginInstallDisclosure> {
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
        ? await readDesktopPluginDirectory(source.path)
        : await this.options.readArchive(source.path, sha256)
    const sourceName = basename(source.path)
    const fallbackId =
      sha256 === null ? sourceName : sourceName.replace(/\.(?:tar\.gz|tgz|zip)$/i, "")
    const bundle = validateDesktopPluginBundle(files, this.options.appVersion, fallbackId)
    this.#assertMayInstall(source.kind, epoch)
    const prepared = {
      confirmationId: randomUUID(),
      sourceKind: source.kind,
      sha256,
    }
    const disclosure: DesktopPluginInstallDisclosure =
      bundle.type === "capability"
        ? { ...prepared, type: "capability", manifest: bundle.manifest }
        : { ...prepared, type: "claude-code", manifest: bundle.manifest }
    this.#pending.set(owner, { bundle, disclosure, epoch, expires: Date.now() + 300_000 })
    return structuredClone(disclosure)
  }

  /** 发布用户确认时看到的同一份快照，无需重新读取原来源。 */
  confirm(confirmationId: string, owner: object): Promise<InstalledDesktopPlugin> {
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
      const installed = {
        revision: randomUUID(),
        installedAt: new Date().toISOString(),
        sourceKind: disclosure.sourceKind,
        sha256: disclosure.sha256,
        enabled: true,
      }
      const record: DesktopPluginRecord =
        bundle.type === "claude-code"
          ? {
              ...installed,
              type: bundle.type,
              manifest: bundle.manifest,
              packageDigest: pluginBundleFilesDigest(bundle.files),
              menuCommands: bundle.menuCommands,
            }
          : {
              ...installed,
              type: bundle.type,
              manifest: bundle.manifest,
              approvedDomains: [...bundle.manifest.networkDomains],
              toolApproval: "always_ask",
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
  setEnabled(pluginId: string, enabled: boolean): Promise<InstalledDesktopPlugin> {
    assertId(pluginId)
    return this.#enqueue(async () => {
      if (enabled) this.#assertActive()
      const record = await this.#records.read(pluginId)
      if (!record) throw new Error("PLUGIN_NOT_INSTALLED")
      if (enabled && !this.#compatible(record)) throw new Error("PLUGIN_VERSION_INCOMPATIBLE")
      const updated = { ...record, enabled }
      if (record.enabled !== enabled) {
        await this.#records.setRecord(updated, enabled ? () => this.#assertActive() : undefined)
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

  /** 在启停和卸载队列中执行当前已启用版本的短操作。 */
  withEnabledPlugin<T>(
    { pluginId, revision }: CapabilityPluginRevision,
    operation: (plugin: InstalledCapabilityPlugin) => T | Promise<T>,
  ): Promise<T> {
    assertId(pluginId)
    return this.#enqueue(async () => {
      this.#assertActive()
      const record = await this.#records.read(pluginId)
      this.#assertActive()
      if (record?.type !== "capability" || record.revision !== revision || !record.enabled)
        throw new Error("PLUGIN_DECLARATION_UNAVAILABLE")
      const plugin = this.#describe(record)
      if (!plugin.compatible) throw new Error("PLUGIN_VERSION_INCOMPATIBLE")
      return operation(plugin)
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
      return this.#snapshot(record)
    })
  }

  /** 启动会话时读取当前启用且兼容的模块副本。损坏的一个包不会阻止其他会话启动。 */
  snapshotEnabled(): Promise<CapabilityPluginSnapshot[]> {
    return this.#enqueue(async () => {
      if (this.options.membership() !== "active") return []
      const epoch = this.#epoch
      const plugins = await Promise.all(
        (await this.#installed()).flatMap((record) =>
          record.type === "capability" && record.enabled && this.#compatible(record)
            ? [this.#snapshot(record).catch(() => null)]
            : [],
        ),
      )
      return this.#epoch === epoch && this.options.membership() === "active"
        ? plugins.filter((value) => value !== null)
        : []
    })
  }

  /** 在会话私有目录中准备当次启动的允许组件，先前会话持有自己的副本。 */
  stageClaudeCodePlugins(directory: string): Promise<readonly string[]> {
    return this.#enqueue(async () => {
      const epoch = this.#epoch
      const paths: string[] = []
      for (const record of await this.#enabledClaudeCodePlugins()) {
        if (this.options.membership() !== "active" || epoch !== this.#epoch) return []
        const path = await this.#records.stageClaudeCodePlugin(record, directory).catch(() => null)
        if (path !== null) paths.push(path)
      }
      return epoch === this.#epoch && this.options.membership() === "active" ? paths : []
    })
  }

  /** 草稿菜单使用启用记录中的 Claude Code 完整命令名。 */
  claudeCodePluginCommands(): Promise<readonly string[]> {
    return this.#enqueue(async () => {
      const epoch = this.#epoch
      const enabled = await this.#enabledClaudeCodePlugins()
      if (epoch !== this.#epoch || this.options.membership() !== "active") return []
      return enabled.flatMap(({ menuCommands }) => menuCommands)
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
      record?.type === "capability" &&
      record.revision === revision &&
      this.#compatible(record)
    )
  }

  /** 串行检查一次能力请求与安装修订；发布数据前必须再次通过回调中的核验。 */
  runCapability<T>(
    pluginId: string,
    revision: string,
    signal: AbortSignal,
    operation: (assertCurrent: () => void) => T | Promise<T>,
  ): Promise<T> {
    const epoch = this.#epoch
    return this.#enqueue(async () => {
      const assertCurrent = () => {
        if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
        if (epoch !== this.#epoch || this.options.membership() !== "active")
          throw new PluginSandboxError("PLUGIN_CAPABILITY_DENIED")
      }
      assertCurrent()
      if (!(await this.canInvoke(pluginId, revision)))
        throw new PluginSandboxError("PLUGIN_CAPABILITY_DENIED")
      assertCurrent()
      const result = await operation(assertCurrent)
      assertCurrent()
      return result
    })
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

  #compatible(record: DesktopPluginRecord): boolean {
    return (
      record.type === "claude-code" ||
      isCapabilityPluginCompatible(record.manifest, this.options.appVersion)
    )
  }

  #describe(record: CapabilityPluginRecord): InstalledCapabilityPlugin
  #describe(record: DesktopPluginRecord): InstalledDesktopPlugin
  #describe(record: DesktopPluginRecord): InstalledDesktopPlugin {
    if (record.type === "claude-code") {
      const { type, manifest, revision, installedAt, sourceKind, sha256, enabled } = record
      return {
        type,
        manifest,
        revision,
        installedAt,
        sourceKind,
        sha256,
        enabled,
        compatible: true,
      }
    }
    return { ...record, compatible: this.#compatible(record) }
  }

  async #installed(): Promise<DesktopPluginRecord[]> {
    const records = await Promise.all(
      (await this.#records.listIds()).map((id) => this.#records.read(id).catch(() => null)),
    )
    return records.filter((record) => record !== null)
  }

  async #enabledClaudeCodePlugins() {
    if (this.options.membership() !== "active") return []
    return (await this.#installed()).filter(
      (record): record is ClaudeCodePluginRecord => record.type === "claude-code" && record.enabled,
    )
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
      toolApproval: record.toolApproval,
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
