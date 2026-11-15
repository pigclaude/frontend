// 持久保存用户确认的第三方市场开关，并吊销来自旧开关状态的请求。

import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { atomicJson, readJson } from "./capability-plugin-records"

/** 缺少有效设置时默认关闭，只有可信窗口可保存显式选择。 */
export class PluginMarketplaceThirdParty {
  #enabled = false
  #revision = 0
  #loaded: Promise<void> | undefined
  #writes = Promise.resolve()

  /** 绑定本机设置、有效会员与已发布状态变化。 */
  constructor(
    private readonly path: string,
    private readonly active: () => boolean,
    private readonly changed: () => void,
  ) {}

  /** 返回实际已发布的用户选择。 */
  async enabled(): Promise<boolean> {
    this.#loaded ??= this.#read()
    await this.#loaded
    return this.#enabled
  }

  /** 串行保存明确选择；写盘不成功时继续沿用原状态。 */
  setEnabled(enabled: boolean): Promise<void> {
    const result = this.#writes.then(async () => {
      this.#requireMembership()
      if ((await this.enabled()) === enabled) return
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await atomicJson(this.path, { enabled }, () => this.#requireMembership())
      this.#enabled = enabled
      this.#revision += 1
      try {
        this.changed()
      } catch {
        // 选择已落盘，窗口订阅失败不改变保存结果。
      }
    })
    this.#writes = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** 获取启动和提交时共用的开关核验，关掉再打开也会使旧请求失效。 */
  async authorize(): Promise<() => void> {
    await this.enabled()
    const revision = this.#revision
    const check = () => {
      this.#requireMembership()
      if (!this.#enabled) throw new Error("PLUGIN_MARKETPLACE_THIRD_PARTY_DISABLED")
      if (revision !== this.#revision) throw new Error("PLUGIN_MARKETPLACE_SOURCE_CHANGED")
    }
    check()
    return check
  }

  async #read(): Promise<void> {
    const value = await readJson(this.path).catch(() => undefined)
    this.#enabled =
      value !== null && typeof value === "object" && "enabled" in value && value.enabled === true
  }

  #requireMembership(): void {
    if (!this.active()) throw new Error("MEMBERSHIP_REQUIRED")
  }
}
