// 核对已获快照的能力插件修订，协调运行中鉴权、卸载/更新和官方吊销。
import {
  isDesktopPluginCompatible,
  type CapabilityPluginRecord,
  type CapabilityPluginRecords,
} from "./capability-plugin-records"
import type { MarketplacePluginRevocations } from "./marketplace-plugin-revocations"
import { isCapabilityPluginId } from "./capability-plugin-paths"
import { PluginSandboxError } from "./plugin-sandbox-contract"

type Options = {
  records: CapabilityPluginRecords
  revocations: MarketplacePluginRevocations
  appVersion: string
  active: () => boolean
  membershipEpoch: () => number
}

type Call = { pluginId: string; revision: string; membershipEpoch: number; signal: AbortSignal }

/** 让作用域内的写入、普通工具调用和退出版本使用同一运行授权。 */
export class CapabilityPluginAuthorization {
  readonly #withdrawing = new Set<string>()
  readonly #withdrawalEpochs = new Map<string, number>()

  /** 绑定当前安装、会员代际和独立发布的官方吊销规则。 */
  constructor(private readonly options: Options) {}

  /** 官方吊销立即撤回旧快照；手动停用仍允许已获准的会话。 */
  async canInvoke(pluginId: string, revision: string): Promise<boolean> {
    return (await this.#currentRecord(pluginId, revision)) !== null
  }

  /** 在管理器串行队列内执行，供数据写入前同步确认调用权限仍然有效。 */
  async run<T>(
    { pluginId, revision, membershipEpoch, signal }: Call,
    operation: (assertCurrent: () => void) => T | Promise<T>,
  ): Promise<T> {
    let authorized: CapabilityPluginRecord | null = null
    const assertCurrent = () => {
      if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
      if (
        membershipEpoch !== this.options.membershipEpoch() ||
        !this.options.active() ||
        (authorized !== null && this.options.revocations.reasonFor(authorized) !== undefined)
      )
        throw new PluginSandboxError("PLUGIN_CAPABILITY_DENIED")
    }
    assertCurrent()
    authorized = await this.#currentRecord(pluginId, revision)
    if (authorized === null) throw new PluginSandboxError("PLUGIN_CAPABILITY_DENIED")
    assertCurrent()
    const result = await operation(assertCurrent)
    assertCurrent()
    return result
  }

  /** 撤回期间拒绝旧版本调用，并让早于撤回的异步读取不能授权。 */
  async duringWithdrawal(id: string, work: () => Promise<void>): Promise<void> {
    this.#withdrawing.add(id)
    this.#withdrawalEpochs.set(id, (this.#withdrawalEpochs.get(id) ?? 0) + 1)
    try {
      await work()
    } finally {
      this.#withdrawing.delete(id)
    }
  }

  async #currentRecord(pluginId: string, revision: string): Promise<CapabilityPluginRecord | null> {
    if (
      !isCapabilityPluginId(pluginId) ||
      this.#withdrawing.has(pluginId) ||
      !this.options.active()
    )
      return null
    const epoch = this.options.membershipEpoch()
    const withdrawal = this.#withdrawalEpochs.get(pluginId)
    const record = await this.options.records.read(pluginId).catch(() => null)
    return epoch === this.options.membershipEpoch() &&
      withdrawal === this.#withdrawalEpochs.get(pluginId) &&
      this.options.active() &&
      !this.#withdrawing.has(pluginId) &&
      record?.type === "capability" &&
      record.revision === revision &&
      isDesktopPluginCompatible(record, this.options.appVersion) &&
      this.options.revocations.reasonFor(record) === undefined
      ? record
      : null
  }
}
