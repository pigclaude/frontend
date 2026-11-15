// 管理独立内存分区的使用权，只把已清理分区归还给原插件版本和出口。

import { PluginSandboxError } from "./plugin-sandbox-contract"

/** 一次窗口启动持有的分区，release 等待这一次使用后的清理。 */
export type PluginSandboxPartitionLease<Profile> = {
  profile: Profile
  release(): Promise<void>
}

type Slot<Profile> = {
  profile: Profile
  reusable: Promise<boolean> | null
}

/** Electron 在主进程内保留具名分区。稳定地复用已清理分区，避免随每次空闲回收增加分区。 */
export class PluginSandboxPartitions<Profile> {
  readonly #slots = new Map<string, Slot<Profile>>()

  /** 提供内存分区创建和清理端口，清理拒绝后该分区会被隔离。 */
  constructor(
    private readonly create: () => Profile,
    private readonly clean: (profile: Profile) => Promise<void>,
  ) {}

  /** 等待上次清理完成，同一键同时只交给一个窗口。清理失败时分配新的分区。 */
  async acquire(key: string, signal: AbortSignal): Promise<PluginSandboxPartitionLease<Profile>> {
    if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
    let slot = this.#slots.get(key)
    if (slot !== undefined) {
      const previous = slot.reusable
      if (previous === null) throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
      const clean = await previous
      if (signal.aborted) throw new PluginSandboxError("PLUGIN_CANCELLED")
      if (this.#slots.get(key) !== slot || slot.reusable !== previous)
        throw new PluginSandboxError("PLUGIN_SANDBOX_UNAVAILABLE")
      if (!clean) slot = undefined
    }
    if (slot === undefined) {
      slot = { profile: this.create(), reusable: null }
      this.#slots.set(key, slot)
    }
    slot.reusable = null
    return this.#lease(slot)
  }

  #lease(slot: Slot<Profile>): PluginSandboxPartitionLease<Profile> {
    let cleanup: Promise<void> | undefined
    return {
      profile: slot.profile,
      release: () => {
        if (cleanup !== undefined) return cleanup
        cleanup = Promise.resolve().then(() => this.clean(slot.profile))
        slot.reusable = cleanup.then(
          () => true,
          () => false,
        )
        return cleanup
      },
    }
  }
}
